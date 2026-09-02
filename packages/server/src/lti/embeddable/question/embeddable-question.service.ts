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
import { ChatbotApiService } from '../../../chatbot/chatbot-api.service';
import { computeMechanicalFacts } from './deterministic-checks';
import {
  buildInitialQuery,
  buildRetryQuery,
  buildUserPrompt,
  extractJsonObject,
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
      question.criteriaText,
      trimmed,
      facts,
      question.instructions,
    );
    const initialQuery = buildInitialQuery(userPrompt);

    let firstText: string;
    try {
      firstText = await this.chatbotApiService.queryChatbotForCourse(
        initialQuery,
        courseId,
        'default',
      );
    } catch (err) {
      this.logger.error(`Chatbot service call failed: ${err}`);
      throw new InternalServerErrorException(
        'Failed to connect to chatbot service',
      );
    }

    let validatedPayload: ValidatedGradePayload;
    try {
      const parsedJson = extractJsonObject(firstText);
      validatedPayload = validateGradePayload(parsedJson);
    } catch (firstParseErr) {
      this.logger.warn(
        `Model output invalid on first attempt, retrying once: ${firstParseErr}`,
      );
      const retryQuery = buildRetryQuery(userPrompt, firstText);
      let retryText: string;
      try {
        retryText = await this.chatbotApiService.queryChatbotForCourse(
          retryQuery,
          courseId,
          'default',
        );
      } catch (err) {
        this.logger.error(`Chatbot service retry call failed: ${err}`);
        throw new InternalServerErrorException(
          'Failed to connect to chatbot service',
        );
      }

      try {
        const retryJson = extractJsonObject(retryText);
        validatedPayload = validateGradePayload(retryJson);
      } catch (retryParseErr) {
        this.logger.error(
          `Model output invalid after retry, failing without saving: ${retryParseErr}`,
        );
        throw new InternalServerErrorException(
          'Model output was not valid feedback JSON after retry.',
        );
      }
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
    });

    return await feedback.save();
  }

  /**
   * Finds all embeddable questions for a given course.
   */
  async findAllForCourse(courseId: number): Promise<EmbeddableQuestionModel[]> {
    return await EmbeddableQuestionModel.find({
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
    const trimmedName = params.name?.trim() || undefined;
    const trimmedQuestionText = params.questionText?.trim();
    const trimmedCriteriaText = params.criteriaText?.trim();
    const trimmedInstructions = params.instructions?.trim() || undefined;

    if (!trimmedQuestionText || !trimmedCriteriaText) {
      throw new BadRequestException('Question and criteria text are required');
    }

    if (
      params.availableFrom &&
      params.availableUntil &&
      new Date(params.availableUntil).getTime() <
        new Date(params.availableFrom).getTime()
    ) {
      throw new BadRequestException(
        'availableUntil cannot be before availableFrom',
      );
    }

    if (questionId) {
      const existing = await this.findOne(courseId, questionId);
      const finalMin = params.minSentences ?? existing.minSentences ?? 3;
      const finalMax = params.maxSentences ?? existing.maxSentences ?? 5;
      if (finalMin > finalMax) {
        throw new BadRequestException(
          'minSentences cannot be greater than maxSentences',
        );
      }
      const availableFrom =
        params.availableFrom !== undefined
          ? params.availableFrom
          : existing.availableFrom;
      const availableUntil =
        params.availableUntil !== undefined
          ? params.availableUntil
          : existing.availableUntil;
      if (
        availableFrom &&
        availableUntil &&
        new Date(availableUntil).getTime() < new Date(availableFrom).getTime()
      ) {
        throw new BadRequestException(
          'availableUntil cannot be before availableFrom',
        );
      }

      existing.name = trimmedName !== undefined ? trimmedName : existing.name;
      existing.questionText = trimmedQuestionText;
      existing.criteriaText = trimmedCriteriaText;
      existing.instructions = trimmedInstructions;
      existing.availableFrom = availableFrom;
      existing.availableUntil = availableUntil;
      existing.minSentences = finalMin;
      existing.maxSentences = finalMax;

      return await existing.save();
    }

    const minSentences = params.minSentences ?? 3;
    const maxSentences = params.maxSentences ?? 5;
    if (minSentences > maxSentences) {
      throw new BadRequestException(
        'minSentences cannot be greater than maxSentences',
      );
    }

    const count = await EmbeddableQuestionModel.count({
      where: { courseId },
    });

    const question = EmbeddableQuestionModel.create({
      courseId,
      name: trimmedName || `Question ${count + 1}`,
      questionText: trimmedQuestionText,
      criteriaText: trimmedCriteriaText,
      instructions: trimmedInstructions,
      availableFrom: params.availableFrom,
      availableUntil: params.availableUntil,
      minSentences,
      maxSentences,
    });

    return await question.save();
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
