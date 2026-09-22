import { Injectable } from '@nestjs/common';
import { CanvasBatchRunStatus } from '@koh/common';
import { CanvasBatchRunModel } from './canvas-batch-run.entity';
import { CanvasBatchAttemptModel } from './canvas-batch-attempt.entity';

/**
 * The only persistence the batch backend needs. It is a thin, concrete data
 * access helper over the two batch tables — not an abstraction with a single
 * implementation — and it owns the one place a real database guarantee matters:
 * claiming the single active run for a course + quiz.
 */
@Injectable()
export class CanvasBatchStore {
  async findActiveRun(
    courseId: number,
    canvasQuizId: number,
  ): Promise<CanvasBatchRunModel | null> {
    return CanvasBatchRunModel.findOne({
      where: { courseId, canvasQuizId, status: CanvasBatchRunStatus.Running },
    });
  }

  /**
   * Claims the single running run for a course + quiz.
   *
   * The partial unique index is the real guard. The pre-check keeps the common
   * case cheap; a unique violation from a concurrent starter is resolved to the
   * winner in a fresh query. Any other database error is re-thrown.
   */
  async createActiveRun(
    data: Partial<CanvasBatchRunModel>,
  ): Promise<CanvasBatchRunModel> {
    const existing = await this.findActiveRun(data.courseId, data.canvasQuizId);
    if (existing) {
      return existing;
    }
    try {
      return (await CanvasBatchRunModel.create(
        data,
      ).save()) as CanvasBatchRunModel;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await this.findActiveRun(data.courseId, data.canvasQuizId);
      if (!winner) {
        throw error;
      }
      return winner;
    }
  }

  async findRun(runId: number): Promise<CanvasBatchRunModel | null> {
    return CanvasBatchRunModel.findOne({ where: { id: runId } });
  }

  async listRuns(courseId: number): Promise<CanvasBatchRunModel[]> {
    return CanvasBatchRunModel.find({
      where: { courseId },
      order: { id: 'DESC' },
    });
  }

  async saveRun(run: CanvasBatchRunModel): Promise<CanvasBatchRunModel> {
    return run.save();
  }

  async listAttempts(runId: number): Promise<CanvasBatchAttemptModel[]> {
    return CanvasBatchAttemptModel.find({
      where: { runId },
      order: { id: 'ASC' },
    });
  }

  async findAttempt(
    runId: number,
    quizSubmissionId: number,
    attemptNumber: number,
  ): Promise<CanvasBatchAttemptModel | null> {
    return CanvasBatchAttemptModel.findOne({
      where: { runId, quizSubmissionId, attemptNumber },
    });
  }

  async createAttempt(
    data: Partial<CanvasBatchAttemptModel>,
  ): Promise<CanvasBatchAttemptModel> {
    return CanvasBatchAttemptModel.create(
      data,
    ).save() as Promise<CanvasBatchAttemptModel>;
  }

  async saveAttempt(
    attempt: CanvasBatchAttemptModel,
  ): Promise<CanvasBatchAttemptModel> {
    return attempt.save();
  }
}

/** Postgres unique-violation code (23505). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}
