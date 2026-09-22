import { Injectable } from '@nestjs/common';
import {
  questionGradingSettingsSchema,
  FINAL_GRADING_INSTRUCTION,
  type GradingEvaluation,
  type GradingSnapshot,
  type QuestionGradingSettings,
} from '@koh/common';
import { ChatbotApiService } from '../../chatbot/chatbot-api.service';
import { computeMechanicalFacts } from './deterministic-check-utils';
import {
  buildAppliedRequirements,
  effectiveScoreCap,
  validateGradePayload,
} from './grading-utils';

@Injectable()
export class QuestionGradingService {
  constructor(private readonly chatbotApiService: ChatbotApiService) {}

  async evaluate({
    courseId,
    questionText,
    gradingSettings,
    submission,
    gradingMode,
    finalInstruction,
  }: {
    courseId: number;
    questionText: string;
    gradingSettings: QuestionGradingSettings;
    submission: string;
    /**
     * Internal batch-only mode. Omitted (or 'practice') is the unchanged
     * practice path; 'final' appends the fixed final-mode suffix.
     */
    gradingMode?: 'final';
    /** Frozen batch instruction; omitted for practice grading. */
    finalInstruction?: string;
  }): Promise<GradingEvaluation> {
    // The one grading-path validation of the settings, before anything is
    // built or called; invalid settings fail before any chatbot call and
    // nothing is persisted.
    const parsed = questionGradingSettingsSchema.safeParse(gradingSettings);
    if (!parsed.success) {
      throw new Error('Question grading settings are invalid.');
    }
    const instruction =
      gradingMode === 'final'
        ? (finalInstruction ?? FINAL_GRADING_INSTRUCTION)
        : undefined;
    const snapshot: GradingSnapshot = structuredClone({
      questionText,
      gradingSettings: parsed.data,
      ...(gradingMode === 'final'
        ? {
            gradingMode: 'final' as const,
            instruction,
          }
        : {}),
    });
    const settings = snapshot.gradingSettings;
    const facts = computeMechanicalFacts(submission, settings.checks);
    const maxScore = settings.scoreScale.max;
    const appliedRequirements = buildAppliedRequirements(
      facts.triggeredChecks,
      facts.blank,
    );
    if (facts.blank) {
      // Blank responses bypass the AI entirely and score zero.
      return {
        score: 0,
        comment: '',
        appliedRequirements,
        maxScore,
        model: null,
        gradingSnapshot: snapshot,
        reasons: ['blank'],
        humanReviewReason: null,
      };
    }

    const effectiveCap = effectiveScoreCap(facts.triggeredChecks);

    // The chatbot service owns provider retries; HelpMe makes exactly one
    // call and validates the answer once. An invalid grade errors out and
    // the caller persists nothing.
    const response = await this.chatbotApiService.queryFeedback(
      submission,
      courseId,
      {
        questionText: snapshot.questionText,
        rubric: settings.rubric,
        feedbackInstructions: settings.feedbackInstructions,
        scoreScale: settings.scoreScale,
        ...(instruction ? { finalInstruction: instruction } : {}),
      },
    );
    const {
      score: rubricScore,
      comment,
      reasons,
      humanReviewReason,
    } = validateGradePayload(response.answer, settings);
    // Keep mechanical checks out of model feedback, then apply their validated
    // score cap deterministically and report it through appliedRequirements.
    const score =
      effectiveCap === null ? rubricScore : Math.min(rubricScore, effectiveCap);
    return {
      score,
      comment,
      appliedRequirements,
      maxScore,
      model: response.model ?? null,
      gradingSnapshot: snapshot,
      reasons,
      humanReviewReason,
    };
  }
}
