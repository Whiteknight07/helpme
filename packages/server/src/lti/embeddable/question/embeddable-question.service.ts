import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { EmbeddableGradingProfileModel } from './grading-profile.entity';
import {
  EmbeddableQuestionFeedback,
  ERROR_MESSAGES,
  GENERIC_DEFAULT_ALLOWED_SCORES,
  GENERIC_DEFAULT_REASON_CODES,
  GENERIC_DEFAULT_SYSTEM_PROMPT,
  INDG_DEFAULT_ALLOWED_SCORES,
  INDG_DEFAULT_REASON_CODES,
  UpsertEmbeddableQuestionParams,
  UpsertGradingProfileParams,
} from '@koh/common';
import { EmbeddableQuestionFeedbackModel } from './embeddable-question-feedback.entity';
import {
  ChatbotApiService,
  FeedbackQueryResult,
} from '../../../chatbot/chatbot-api.service';
import { computeMechanicalFacts } from './deterministic-checks';
import {
  buildSystemPrompt,
  buildUserPrompt,
  postProcessFeedback,
  validateGradePayload,
  ValidatedGradePayload,
} from './grading';

function matchesIndgContract(scores: number[], reasons: string[]): boolean {
  return (
    scores.length === INDG_DEFAULT_ALLOWED_SCORES.length &&
    reasons.length === INDG_DEFAULT_REASON_CODES.length &&
    scores.every((score) => INDG_DEFAULT_ALLOWED_SCORES.includes(score)) &&
    reasons.every((reason) => INDG_DEFAULT_REASON_CODES.includes(reason))
  );
}

/**
 * Discriminated feedback attribution. Normal HelpMe traffic carries a
 * userId; Canvas resource launches carry the LTI issuer+subject pair with
 * an optional staff userId for instructor previews.
 */
export type EmbeddableFeedbackAttribution =
  | { kind: 'user'; userId: number }
  | {
      kind: 'lti';
      ltiIssuer: string;
      ltiSubject: string;
      userId?: number;
    };

@Injectable()
export class EmbeddableQuestionService {
  private readonly logger = new Logger(EmbeddableQuestionService.name);

  constructor(private readonly chatbotApiService: ChatbotApiService) {}

  /**
   * Evaluates student draft against the course grading profile and
   * returns/saves validated feedback.
   *
   * @param submission The student's draft response
   * @param questionId The question ID
   * @param courseId The course ID
   * @param attribution Who the attempt belongs to
   */
  async getFeedback(
    submission: string,
    questionId: number,
    courseId: number,
    attribution: EmbeddableFeedbackAttribution,
  ): Promise<EmbeddableQuestionFeedback> {
    const question = await this.findOne(courseId, questionId);
    const profile = await this.getProfile(courseId);

    const facts = computeMechanicalFacts(
      submission,
      question.minSentences,
      question.maxSentences,
    );

    const userPrompt = buildUserPrompt(
      question.questionText,
      submission,
      facts,
      question.instructions,
      profile,
    );

    let chatbotResult: FeedbackQueryResult;
    try {
      chatbotResult = await this.chatbotApiService.queryChatbotForCourse(
        userPrompt,
        courseId,
        'feedback',
        { systemPrompt: buildSystemPrompt(profile, question.criteriaText) },
      );
    } catch (err) {
      this.logger.error(`Chatbot service call failed: ${err}`);
      throw new InternalServerErrorException(
        'Failed to connect to chatbot service',
      );
    }

    let validatedPayload: ValidatedGradePayload;
    try {
      validatedPayload = validateGradePayload(chatbotResult.answer, profile);
    } catch {
      this.logger.error('Grading profile validation failed');
      throw new InternalServerErrorException(
        'Model output was not valid feedback JSON.',
      );
    }

    const postProcessed = postProcessFeedback(validatedPayload, facts, profile);

    const feedback = EmbeddableQuestionFeedbackModel.create({
      courseId,
      questionId,
      userId:
        attribution.kind === 'user'
          ? attribution.userId
          : (attribution.userId ?? null),
      ltiIssuer: attribution.kind === 'lti' ? attribution.ltiIssuer : null,
      ltiSubject: attribution.kind === 'lti' ? attribution.ltiSubject : null,
      submission,
      aiFeedback: postProcessed.comment,
      aiGrade: postProcessed.score,
      reasons: postProcessed.reasons,
      needsHumanReview: postProcessed.needsHumanReview,
      aiModel: chatbotResult.model ?? null,
    });

    const saved = await feedback.save();

    return {
      score: saved.aiGrade,
      comment: saved.aiFeedback,
      reasons: saved.reasons,
      needsHumanReview: saved.needsHumanReview,
      maxScore: Math.max(...profile.allowedScores),
    };
  }

  /**
   * Returns the course's grading profile, creating the generic default on
   * first use. The insert ignores conflicts so concurrent first calls still
   * leave exactly one row per course.
   */
  async getProfile(courseId: number): Promise<EmbeddableGradingProfileModel> {
    await EmbeddableGradingProfileModel.createQueryBuilder()
      .insert()
      .into(EmbeddableGradingProfileModel)
      .values({
        courseId,
        policyKind: 'generic',
        systemPrompt: GENERIC_DEFAULT_SYSTEM_PROMPT,
        allowedScores: [...GENERIC_DEFAULT_ALLOWED_SCORES],
        reasonCodes: [...GENERIC_DEFAULT_REASON_CODES],
      })
      .orIgnore()
      .execute();
    const profile = await EmbeddableGradingProfileModel.findOne({
      where: { courseId },
    });
    if (!profile) {
      throw new InternalServerErrorException('Failed to load grading profile');
    }
    return profile;
  }

  /**
   * Updates the course's single grading profile. The INDG policy is only
   * valid with the INDG scores and reason codes; its system prompt stays
   * editable.
   */
  async updateProfile(
    courseId: number,
    params: UpsertGradingProfileParams,
  ): Promise<EmbeddableGradingProfileModel> {
    if (
      params.policyKind === 'indg-reflection' &&
      !matchesIndgContract(params.allowedScores, params.reasonCodes)
    ) {
      throw new BadRequestException(
        'indg-reflection profiles must use the INDG scores and reason codes',
      );
    }
    const profile = await this.getProfile(courseId);
    profile.policyKind = params.policyKind;
    profile.systemPrompt = params.systemPrompt;
    profile.allowedScores = [...params.allowedScores];
    profile.reasonCodes = [...params.reasonCodes];
    return profile.save();
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
    const name = params.name ?? null;
    const questionText = params.questionText;
    const criteriaText = params.criteriaText ?? '';
    const instructions = params.instructions ?? null;
    const minSentences = params.minSentences ?? 3;
    const maxSentences = params.maxSentences ?? 5;

    if (minSentences > maxSentences) {
      throw new BadRequestException(
        'minSentences cannot be greater than maxSentences.',
      );
    }

    if (questionId !== undefined) {
      const existing = await this.findOne(courseId, questionId);

      existing.name = name;
      existing.questionText = questionText;
      existing.criteriaText = criteriaText;
      existing.instructions = instructions;
      existing.minSentences = minSentences;
      existing.maxSentences = maxSentences;

      return existing.save();
    }

    const question = EmbeddableQuestionModel.create({
      courseId,
      name,
      questionText,
      criteriaText,
      instructions,
      minSentences,
      maxSentences,
    });

    return question.save();
  }

  /**
   * Deletes an embeddable question.
   */
  async delete(courseId: number, questionId: number): Promise<void> {
    await this.findOne(courseId, questionId);
    await EmbeddableQuestionModel.delete({
      id: questionId,
      courseId,
    });
  }
}
