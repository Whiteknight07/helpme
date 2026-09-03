import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { ERROR_MESSAGES, UpsertEmbeddableQuestionParams } from '@koh/common';
import { EmbeddableQuestionFeedbackModel } from './embeddable-question-feedback.entity';
import {
  ChatbotApiService,
  FeedbackQueryResult,
} from '../../../chatbot/chatbot-api.service';
import { computeMechanicalFacts } from './deterministic-checks';
import {
  buildSystemPrompt,
  buildUserPrompt,
  DEFAULT_RUBRIC,
  postProcessFeedback,
  validateGradePayload,
  ValidatedGradePayload,
} from './indg-grading';

@Injectable()
export class EmbeddableQuestionService {
  private readonly logger = new Logger(EmbeddableQuestionService.name);

  constructor(private readonly chatbotApiService: ChatbotApiService) {}

  /**
   * Evaluates student draft against INDG criteria and returns/saves validated feedback.
   *
   * @param submission The student's draft response
   * @param questionId The question ID
   * @param courseId The course ID
   * @param userId The ID of the authenticated user
   */
  async getFeedback(
    submission: string,
    questionId: number,
    courseId: number,
    userId: number,
  ): Promise<EmbeddableQuestionFeedbackModel> {
    const trimmed = submission?.trim();
    if (!trimmed) {
      throw new BadRequestException('Input is required');
    }

    const question = await EmbeddableQuestionModel.findOne({
      where: {
        id: questionId,
        courseId,
      },
    });

    if (!question) {
      throw new NotFoundException(ERROR_MESSAGES.embeddableModule.notFound);
    }

    if (
      question.availableFrom &&
      question.availableFrom.getTime() > Date.now()
    ) {
      throw new UnauthorizedException(
        ERROR_MESSAGES.embeddableModule.notAvailableYet,
      );
    } else if (
      question.availableUntil &&
      question.availableUntil.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        ERROR_MESSAGES.embeddableModule.noLongerAvailable,
      );
    }

    const facts = computeMechanicalFacts(
      trimmed,
      question.minSentences ?? 3,
      question.maxSentences ?? 5,
    );

    const userPrompt = buildUserPrompt(
      question.questionText,
      trimmed,
      facts,
      question.instructions,
    );

    let chatbotResult: FeedbackQueryResult;
    try {
      chatbotResult = await this.chatbotApiService.queryChatbotForCourse(
        userPrompt,
        courseId,
        'feedback',
        { systemPrompt: buildSystemPrompt(question.criteriaText) },
      );
    } catch (err) {
      this.logger.error(`Chatbot service call failed: ${err}`);
      throw new InternalServerErrorException(
        'Failed to connect to chatbot service',
      );
    }

    let validatedPayload: ValidatedGradePayload;
    try {
      validatedPayload = validateGradePayload(chatbotResult.answer);
    } catch {
      this.logger.error('INDG semantic validation failed');
      throw new InternalServerErrorException(
        'Model output was not valid feedback JSON.',
      );
    }

    const postProcessed = postProcessFeedback(validatedPayload, facts);

    const feedback = EmbeddableQuestionFeedbackModel.create({
      courseId,
      questionId,
      userId,
      submission: trimmed,
      aiFeedback: postProcessed.comment,
      aiGrade: postProcessed.score,
      reasons: postProcessed.reasons,
      needsHumanReview: postProcessed.needsHumanReview,
      aiModel: chatbotResult.model ?? null,
    });

    return feedback.save();
  }

  /**
   * Finds all embeddable questions for a given course.
   */
  async findAllForCourse(courseId: number): Promise<EmbeddableQuestionModel[]> {
    return EmbeddableQuestionModel.find({
      where: { courseId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Finds one question scoped to a course.
   */
  async findOne(
    courseId: number,
    questionId: number,
  ): Promise<EmbeddableQuestionModel> {
    const question = await EmbeddableQuestionModel.findOne({
      where: { id: questionId, courseId },
    });
    if (!question) {
      throw new NotFoundException(ERROR_MESSAGES.embeddableModule.notFound);
    }
    return question;
  }

  /**
   * Creates or updates an embeddable question.
   */
  async upsert(
    courseId: number,
    params: UpsertEmbeddableQuestionParams,
    questionId?: number,
  ): Promise<EmbeddableQuestionModel> {
    const trimmedName =
      typeof params.name === 'string' && params.name.trim().length > 0
        ? params.name.trim()
        : null;
    const trimmedQuestionText = params.questionText?.trim();
    const finalCriteriaText = params.criteriaText?.trim() || DEFAULT_RUBRIC;
    const trimmedInstructions =
      typeof params.instructions === 'string' &&
      params.instructions.trim().length > 0
        ? params.instructions.trim()
        : null;

    if (!trimmedQuestionText) {
      throw new BadRequestException('Question text is required');
    }

    const availableFrom = params.availableFrom
      ? new Date(params.availableFrom)
      : null;
    const availableUntil = params.availableUntil
      ? new Date(params.availableUntil)
      : null;

    if (
      availableFrom &&
      availableUntil &&
      availableUntil.getTime() < availableFrom.getTime()
    ) {
      throw new BadRequestException(
        'availableUntil cannot be before availableFrom',
      );
    }

    const minSentences = params.minSentences ?? 3;
    const maxSentences = params.maxSentences ?? 5;
    if (minSentences > maxSentences) {
      throw new BadRequestException(
        'minSentences cannot be greater than maxSentences',
      );
    }

    if (questionId) {
      const existing = await this.findOne(courseId, questionId);

      existing.name = trimmedName;
      existing.questionText = trimmedQuestionText;
      existing.criteriaText = finalCriteriaText;
      existing.instructions = trimmedInstructions;
      existing.availableFrom = availableFrom;
      existing.availableUntil = availableUntil;
      existing.minSentences = minSentences;
      existing.maxSentences = maxSentences;

      return existing.save();
    }

    const count = await EmbeddableQuestionModel.count({
      where: { courseId },
    });

    const question = EmbeddableQuestionModel.create({
      courseId,
      name: trimmedName || `Question ${count + 1}`,
      questionText: trimmedQuestionText,
      criteriaText: finalCriteriaText,
      instructions: trimmedInstructions,
      availableFrom,
      availableUntil,
      minSentences,
      maxSentences,
    });

    return question.save();
  }

  /**
   * Deletes an embeddable question.
   */
  async delete(courseId: number, questionId: number): Promise<void> {
    const question = await this.findOne(courseId, questionId);
    await EmbeddableQuestionModel.delete({
      id: question.id,
      courseId,
    });
  }
}
