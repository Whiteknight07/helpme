import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CanvasBatchAttemptStatus,
  CanvasBatchQuestionStatus,
  CanvasBatchQuestionWork,
  CanvasBatchQuestionWrite,
  CanvasBatchRunStatus,
  ERROR_MESSAGES,
  LMSApiResponseStatus,
} from '@koh/common';
import { LMSIntegrationService } from '../../../lmsIntegration/lmsIntegration.service';
import { QuestionGradingService } from '../../embeddable-question/question-grading.service';
import { CanvasBatchRunModel } from './canvas-batch-run.entity';
import { CanvasBatchAttemptModel } from './canvas-batch-attempt.entity';
import { CanvasBatchStore } from './canvas-batch.store';
import {
  AbstractLMSAdapter,
  LMSClassicAttempt,
  LMSWriteResult,
} from '../../../lmsIntegration/lmsIntegration.adapter';
import {
  buildGradingSnapshot,
  classifyDiscoveredAnswer,
  existingGradeState,
  hashAnswer,
  mappingChangedError,
  UNREADABLE_ATTEMPT_ERROR,
} from './canvas-batch.logic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeMessage(result: LMSWriteResult): string {
  return result.outcome === 'unknown'
    ? `Canvas write outcome is unknown. Check SpeedGrader before starting another run; the write was not retried. ${result.message ?? ''}`
    : `Canvas rejected the write${result.httpStatus ? ` (${result.httpStatus})` : ''}. ${result.message ?? ''}`;
}

/** SpeedGrader note for staff; null when no question was flagged. */
export function reviewComment(
  questions: CanvasBatchQuestionWork[],
): string | null {
  const reasons = questions
    .filter((question) => question.humanReviewReason)
    .map(
      (question) =>
        `Question ${question.position} review reason: ${question.humanReviewReason}`,
    );
  return reasons.length
    ? [
        'REVIEW REQUIRED (HelpMe AI)',
        ...reasons,
        'Delete this comment before posting grades; students can see it once grades are posted.',
      ].join('\n\n')
    : null;
}

/**
 * The single batch worker. It discovers every eligible completed attempt,
 * grades each mapped question, persists the validated result, and prefills the
 * per-question scores and comments. It never posts or releases grades.
 *
 * Each student is processed as one unit: every question must grade and pass a
 * fresh Canvas preflight before one complete grade request is sent.
 */
@Injectable()
export class CanvasBatchRunnerService {
  private readonly logger = new Logger(CanvasBatchRunnerService.name);

  constructor(
    private readonly store: CanvasBatchStore,
    private readonly lmsIntegrationService: LMSIntegrationService,
    private readonly questionGradingService: QuestionGradingService,
  ) {}

  /** Discovers, grades, and prefills every eligible attempt for a run. */
  async run(runId: number): Promise<void> {
    const run = await this.store.findRun(runId);
    if (!run || run.status !== CanvasBatchRunStatus.Running) {
      return;
    }
    try {
      const adapter = await this.transport(run.courseId);
      await this.discoverAttempts(run, adapter);
      const attempts = await this.store.listAttempts(run.id);
      for (const attempt of attempts) {
        await this.processAttempt(run, adapter, attempt);
      }
      await this.completeRun(run);
    } catch (error) {
      run.status = CanvasBatchRunStatus.Failed;
      run.error = `Batch processing stopped: ${getErrorMessage(error)} Resolve the error, check SpeedGrader for any existing grades, then start a new run.`;
      run.completedAt = new Date();
      await this.store.saveRun(run);
      this.logger.warn(`Batch run ${run.id} failed: ${getErrorMessage(error)}`);
    }
  }

  private async transport(courseId: number): Promise<AbstractLMSAdapter> {
    const adapter = await this.lmsIntegrationService.getAdapter(courseId);
    if (!adapter) {
      throw new BadRequestException(
        ERROR_MESSAGES.lmsController.noLMSIntegration,
      );
    }
    return adapter;
  }

  /**
   * Records every eligible completed attempt that is not already known to this
   * run. Attempts already recorded are left alone, so a resume discovers only
   * later attempts. Attempts that Canvas reported as unreadable are retained so
   * the run can record a staff error.
   */
  private async discoverAttempts(
    run: CanvasBatchRunModel,
    adapter: AbstractLMSAdapter,
  ): Promise<void> {
    const result = await adapter.getClassicAttemptSnapshots({
      quizId: run.canvasQuizId,
      assignmentId: run.assignmentId,
    });
    if (result.status !== LMSApiResponseStatus.Success || !result.snapshot) {
      throw new BadRequestException(result.status);
    }

    for (const attempt of result.snapshot.attempts) {
      if (attempt.excused) {
        continue;
      }
      const existing = await this.store.findAttempt(
        run.id,
        attempt.quizSubmissionId,
        attempt.attempt,
      );
      if (existing) {
        continue;
      }
      const questions = this.buildQuestionWork(run, attempt);
      await this.store.createAttempt({
        runId: run.id,
        quizSubmissionId: attempt.quizSubmissionId,
        canvasUserId: attempt.userId,
        attemptNumber: attempt.attempt,
        status: CanvasBatchAttemptStatus.Pending,
        readable: attempt.readable,
        questions,
        error: attempt.readable ? null : UNREADABLE_ATTEMPT_ERROR,
      });
    }
  }

  private buildQuestionWork(
    run: CanvasBatchRunModel,
    attempt: LMSClassicAttempt,
  ): CanvasBatchQuestionWork[] {
    return run.questions.map((question) => {
      const answer = attempt.readable
        ? attempt.answers.find(
            (candidate) => candidate.questionId === question.canvasQuestionId,
          )
        : undefined;
      const discovered = classifyDiscoveredAnswer(answer, attempt.readable);
      return {
        canvasQuestionId: question.canvasQuestionId,
        position: question.position,
        embeddableQuestionId: question.embeddableQuestionId,
        maxScore: question.helpMeMax,
        answer: answer ? answer.text : null,
        answerHash: hashAnswer(answer ? answer.text : ''),
        gradingSnapshot: buildGradingSnapshot(run.instruction, question),
        status: discovered.status,
        score: discovered.score,
        comment: discovered.comment,
        model: null,
        reasons: discovered.reasons,
        humanReviewReason: null,
        error: discovered.error,
      };
    });
  }

  private async processAttempt(
    run: CanvasBatchRunModel,
    adapter: AbstractLMSAdapter,
    attempt: CanvasBatchAttemptModel,
  ): Promise<void> {
    try {
      await this.gradeQuestions(run, attempt);
      await this.store.saveAttempt(attempt);
      await this.prefillAttempt(run, adapter, attempt);
      this.finalizeAttempt(attempt);
      await this.store.saveAttempt(attempt);
    } catch (error) {
      attempt.status = CanvasBatchAttemptStatus.Error;
      attempt.error = `Batch processing failed: ${getErrorMessage(error)}`;
      await this.store.saveAttempt(attempt);
      this.logger.warn(
        `Batch attempt ${attempt.id} for run ${run.id} failed: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Grades every pending question in memory. Questions already graded are never
   * re-sent to the model.
   */
  private async gradeQuestions(
    run: CanvasBatchRunModel,
    attempt: CanvasBatchAttemptModel,
  ): Promise<void> {
    if (
      attempt.questions.some(
        (question) =>
          question.status === CanvasBatchQuestionStatus.Error ||
          question.status === CanvasBatchQuestionStatus.Skipped,
      )
    ) {
      this.markPendingSkipped(attempt.questions);
      return;
    }
    for (const question of attempt.questions) {
      if (question.status !== CanvasBatchQuestionStatus.Pending) {
        continue;
      }
      try {
        const evaluation = await this.questionGradingService.evaluate({
          courseId: run.courseId,
          questionText: question.gradingSnapshot.questionText,
          gradingSettings: question.gradingSnapshot.gradingSettings,
          submission: question.answer ?? '',
          gradingMode: 'final',
          finalInstruction: run.instruction,
        });
        question.score = evaluation.score;
        question.comment = [
          evaluation.comment,
          ...evaluation.appliedRequirements,
        ]
          .filter(Boolean)
          .join('\n\n');
        question.model = evaluation.model;
        question.reasons = evaluation.reasons;
        question.humanReviewReason = evaluation.humanReviewReason;
        question.error = null;
        question.status = CanvasBatchQuestionStatus.Graded;
      } catch (error) {
        // Unavailable or malformed output is a staff-visible error. It is never
        // converted into a zero score and never written to Canvas.
        question.status = CanvasBatchQuestionStatus.Error;
        question.score = null;
        question.comment = null;
        question.humanReviewReason = null;
        question.error = `Grading failed: ${getErrorMessage(error)}`;
        this.logger.warn(
          `Batch question ${question.canvasQuestionId} for run ${run.id} failed to grade: ${getErrorMessage(error)}`,
        );
        this.markPendingSkipped(attempt.questions);
        return;
      }
    }
  }

  /**
   * Prefills one attempt's safe question scores and comments in a single Canvas
   * request. The catalog and the attempt are re-read uncached immediately
   * before the write; anything that changed since grading blocks the write.
   */
  private async prefillAttempt(
    run: CanvasBatchRunModel,
    adapter: AbstractLMSAdapter,
    attempt: CanvasBatchAttemptModel,
  ): Promise<void> {
    if (
      !attempt.questions.every(
        (question) => question.status === CanvasBatchQuestionStatus.Graded,
      )
    ) {
      return;
    }

    const catalogError = await this.preflightCatalog(run, adapter);
    if (catalogError) {
      this.markWriteError(attempt.questions, catalogError);
      return;
    }

    const live = await this.safeReadAttempt(adapter, run, attempt);
    if (!live) {
      this.markWriteError(
        attempt.questions,
        'Could not re-read the attempt from Canvas before writing; nothing was written.',
      );
      return;
    }
    if (!live.readable) {
      this.markWriteError(
        attempt.questions,
        'Canvas did not return usable submission history when the attempt was re-read; nothing was written.',
      );
      return;
    }
    if (live.excused) {
      this.markWriteSkipped(attempt.questions);
      return;
    }
    if (live.postedAt != null) {
      this.markWriteSkipped(attempt.questions);
      return;
    }

    const writes: {
      canvasQuestionId: number;
      score: number;
      comment: string;
    }[] = [];
    for (const question of attempt.questions) {
      const answer = live.answers.find(
        (candidate) => candidate.questionId === question.canvasQuestionId,
      );
      if (!answer) {
        this.markWriteError(
          attempt.questions,
          'Canvas did not return this question when the attempt was re-read; nothing was written.',
        );
        return;
      }
      if (hashAnswer(answer.text) !== question.answerHash) {
        this.markWriteError(
          attempt.questions,
          'The student answer changed after grading, so this question was not written.',
        );
        return;
      }
      if (question.score === null || question.comment === null) {
        this.markWriteError(
          attempt.questions,
          'A completed grade was missing its score or comment; nothing was written.',
        );
        return;
      }
      const expected: CanvasBatchQuestionWrite = {
        score: question.score,
        comment: question.comment,
      };
      const state = existingGradeState(answer, expected);
      if (state === 'foreign') {
        this.markWriteSkipped(attempt.questions);
        return;
      }
      if (state === 'absent') {
        writes.push({
          canvasQuestionId: question.canvasQuestionId,
          score: expected.score,
          comment: expected.comment,
        });
      }
    }

    if (writes.length === 0) {
      this.markPosted(attempt.questions);
      return;
    }
    await this.sendWrites(run, adapter, attempt, writes);
  }

  /** Returns a block reason when the live catalog no longer matches the run. */
  private async preflightCatalog(
    run: CanvasBatchRunModel,
    adapter: AbstractLMSAdapter,
  ): Promise<string | null> {
    const result = await adapter.getClassicQuizCatalog(run.canvasQuizId);
    if (result.status !== LMSApiResponseStatus.Success) {
      return `Could not re-read the Canvas quiz catalog: ${result.status} Nothing was written.`;
    }
    const quiz = result.quizzes.find(
      (candidate) => candidate.quizId === run.canvasQuizId,
    );
    if (!quiz) {
      return 'The Canvas quiz is no longer available; nothing was written.';
    }
    if (!quiz.postManually) {
      return 'Canvas manual posting was turned off; nothing was written.';
    }
    return mappingChangedError(quiz, run.questions);
  }

  /** Sends every question score and comment for the attempt in one PUT. */
  private async sendWrites(
    run: CanvasBatchRunModel,
    adapter: AbstractLMSAdapter,
    attempt: CanvasBatchAttemptModel,
    writes: { canvasQuestionId: number; score: number; comment: string }[],
  ): Promise<void> {
    const result = await adapter.putClassicAttemptGrades({
      quizId: run.canvasQuizId,
      quizSubmissionId: attempt.quizSubmissionId,
      attempt: attempt.attemptNumber,
      questions: writes.map((write) => ({
        questionId: write.canvasQuestionId,
        score: write.score,
        comment: write.comment,
      })),
    });
    if (result.outcome === 'success') {
      this.markPosted(attempt.questions);
      const text = reviewComment(attempt.questions);
      if (text) {
        const commented = await adapter.putSubmissionComment({
          assignmentId: run.assignmentId,
          userId: attempt.canvasUserId,
          text,
        });
        if (commented.outcome !== 'success') {
          attempt.error = `Grades were prefilled, but the review comment was not added. ${outcomeMessage(commented)}`;
        }
      }
    } else {
      this.markWriteError(attempt.questions, outcomeMessage(result));
    }
  }

  private finalizeAttempt(attempt: CanvasBatchAttemptModel): void {
    const hasError = attempt.questions.some(
      (question) => question.status === CanvasBatchQuestionStatus.Error,
    );
    attempt.status = hasError
      ? CanvasBatchAttemptStatus.Error
      : CanvasBatchAttemptStatus.Prefilled;
  }

  private markPosted(questions: CanvasBatchQuestionWork[]): void {
    for (const question of questions) {
      question.status = CanvasBatchQuestionStatus.Posted;
      question.error = null;
    }
  }

  private markWriteError(
    questions: CanvasBatchQuestionWork[],
    message: string,
  ): void {
    for (const question of questions) {
      question.status = CanvasBatchQuestionStatus.Error;
      question.error = message;
    }
  }

  private markWriteSkipped(questions: CanvasBatchQuestionWork[]): void {
    for (const question of questions) {
      question.status = CanvasBatchQuestionStatus.Skipped;
      question.error = null;
    }
  }

  private markPendingSkipped(questions: CanvasBatchQuestionWork[]): void {
    for (const question of questions) {
      if (question.status === CanvasBatchQuestionStatus.Pending) {
        question.status = CanvasBatchQuestionStatus.Skipped;
      }
    }
  }

  private async safeReadAttempt(
    adapter: AbstractLMSAdapter,
    run: CanvasBatchRunModel,
    attempt: CanvasBatchAttemptModel,
  ): Promise<LMSClassicAttempt | null> {
    const result = await adapter.getClassicAttemptSnapshot({
      quizId: run.canvasQuizId,
      assignmentId: run.assignmentId,
      userId: attempt.canvasUserId,
      attempt: attempt.attemptNumber,
    });
    if (result.status !== LMSApiResponseStatus.Success) {
      throw new Error(
        `Could not re-read the Canvas attempt: ${result.status} Nothing was written.`,
      );
    }
    if (!result.snapshot) return null;
    return (
      result.snapshot.attempts.find(
        (candidate) =>
          candidate.quizSubmissionId === attempt.quizSubmissionId &&
          candidate.attempt === attempt.attemptNumber,
      ) ?? null
    );
  }

  private async completeRun(run: CanvasBatchRunModel): Promise<void> {
    run.status = CanvasBatchRunStatus.Completed;
    run.completedAt = new Date();
    await this.store.saveRun(run);
  }
}
