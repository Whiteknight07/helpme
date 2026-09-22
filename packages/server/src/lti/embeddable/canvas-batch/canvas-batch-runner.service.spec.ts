import {
  CanvasBatchAttemptStatus,
  CanvasBatchQuestionStatus,
  CanvasBatchRunStatus,
  FINAL_GRADING_INSTRUCTION,
  LMSApiResponseStatus,
  type CanvasBatchQuestionSnapshot,
  type QuestionGradingSettings,
} from '@koh/common';
import type {
  LMSClassicAttempt,
  LMSClassicQuiz,
} from '../../../lmsIntegration/lmsIntegration.adapter';
import { CanvasBatchAttemptModel } from './canvas-batch-attempt.entity';
import { CanvasBatchService } from './canvas-batch.service';
import { CanvasBatchRunnerService } from './canvas-batch-runner.service';
import { CanvasBatchRunModel } from './canvas-batch-run.entity';
import type { CanvasBatchStore } from './canvas-batch.store';

const gradingSettings: QuestionGradingSettings = {
  rubric: 'Award points for an accurate answer.',
  feedbackInstructions: 'Be concise.',
  scoreScale: { max: 5, step: 1 },
  checks: [],
};

function question(id: number, position: number): CanvasBatchQuestionSnapshot {
  return {
    canvasQuestionId: id,
    lookupUuid: `${String(id).padStart(8, '0')}-1111-4111-8111-111111111111`,
    position,
    text: `Question ${position}`,
    embeddableQuestionId: id,
    canvasPoints: 5,
    helpMeMax: 5,
    questionText: `Question ${position}`,
    gradingSettings,
  };
}

const questions = [question(101, 1), question(102, 2)];

function run(): CanvasBatchRunModel {
  return {
    id: 7,
    createdAt: new Date('2026-09-16T00:00:00.000Z'),
    courseId: 3,
    canvasQuizId: 55,
    assignmentId: 900,
    canvasQuizTitle: 'Essay Quiz',
    status: CanvasBatchRunStatus.Running,
    gradingMode: 'final',
    instruction: FINAL_GRADING_INSTRUCTION,
    speedGraderUrl: 'https://canvas.test/speed_grader?assignment_id=900',
    createdByUserId: 1,
    questions,
    completedAt: null,
  } as CanvasBatchRunModel;
}

function canvasAttempt(): LMSClassicAttempt {
  return {
    quizSubmissionId: 500,
    userId: 42,
    attempt: 1,
    postedAt: null,
    excused: false,
    readable: true,
    answers: [
      { questionId: 101, text: 'First answer.', points: null, comment: null },
      { questionId: 102, text: 'Second answer.', points: null, comment: null },
    ],
  };
}

function quiz(): LMSClassicQuiz {
  return {
    quizId: 55,
    title: 'Essay Quiz',
    assignmentId: 900,
    postManually: true,
    speedGraderUrl: 'https://canvas.test/speed_grader?assignment_id=900',
    essayQuestions: questions.map((item) => ({
      id: item.canvasQuestionId,
      position: item.position,
      text: item.text,
      points: item.canvasPoints,
      mapping: {
        status: 'detected',
        lookupUuid: item.lookupUuid,
        embeddableQuestionId: item.embeddableQuestionId,
      },
    })),
  };
}

function evaluation(score: number) {
  return {
    score,
    comment: 'Good answer.',
    appliedRequirements: [],
    maxScore: 5,
    model: 'test-model',
    gradingSnapshot: {
      questionText: 'Question',
      gradingSettings,
      gradingMode: 'final' as const,
      instruction: FINAL_GRADING_INSTRUCTION,
    },
    reasons: ['accurate'],
    humanReviewReason: null,
  };
}

function harness(
  evaluate: jest.Mock,
  options: {
    postManually?: boolean;
    liveGrade?: { score: number; comment: string };
  } = {},
) {
  const batchRun = run();
  const discoveredAttempt = canvasAttempt();
  const liveAttempt = canvasAttempt();
  if (options.liveGrade) {
    for (const answer of liveAttempt.answers) {
      answer.points = options.liveGrade.score;
      answer.comment = options.liveGrade.comment;
    }
  }
  const liveQuiz = quiz();
  liveQuiz.postManually = options.postManually ?? true;
  const attempts: CanvasBatchAttemptModel[] = [];
  const store = {
    findRun: jest.fn(async () => structuredClone(batchRun)),
    listAttempts: jest.fn(async () => attempts),
    findAttempt: jest.fn().mockResolvedValue(null),
    createAttempt: jest.fn(async (data: Partial<CanvasBatchAttemptModel>) => {
      const created = {
        id: 1,
        createdAt: new Date(),
        ...data,
      } as CanvasBatchAttemptModel;
      attempts.push(created);
      return created;
    }),
    saveAttempt: jest.fn(async (item: CanvasBatchAttemptModel) => item),
    saveRun: jest.fn(async (item: CanvasBatchRunModel) =>
      Object.assign(batchRun, item),
    ),
  };
  const adapter = {
    getClassicAttemptSnapshots: jest.fn().mockResolvedValue({
      status: LMSApiResponseStatus.Success,
      snapshot: { quizId: 55, attempts: [discoveredAttempt] },
    }),
    getClassicQuizCatalog: jest.fn().mockResolvedValue({
      status: LMSApiResponseStatus.Success,
      quizzes: [liveQuiz],
    }),
    getClassicAttemptSnapshot: jest.fn().mockResolvedValue({
      status: LMSApiResponseStatus.Success,
      snapshot: { quizId: 55, attempts: [liveAttempt] },
    }),
    putClassicAttemptGrades: jest
      .fn()
      .mockResolvedValue({ outcome: 'success' }),
    putSubmissionComment: jest.fn().mockResolvedValue({ outcome: 'success' }),
  };
  const getAdapter = jest.fn().mockResolvedValue(adapter);
  const runner = new CanvasBatchRunnerService(
    store as unknown as CanvasBatchStore,
    { getAdapter } as never,
    { evaluate } as never,
  );
  return { runner, attempts, adapter, batchRun, store, getAdapter };
}

describe('CanvasBatchRunnerService', () => {
  it.each([
    LMSApiResponseStatus.Unauthorized,
    LMSApiResponseStatus.Forbidden,
    LMSApiResponseStatus.Error,
  ])('persists a recoverable discovery failure: %s', async (status) => {
    const { runner, adapter, batchRun, store } = harness(jest.fn());
    adapter.getClassicAttemptSnapshots.mockResolvedValue({ status });
    await runner.run(7);
    expect(batchRun.status).toBe(CanvasBatchRunStatus.Failed);
    expect(batchRun.error).toContain(status);
    expect(batchRun.error).toContain('start a new run');
    const reportService = new CanvasBatchService(
      {} as never,
      store as unknown as CanvasBatchStore,
      {} as never,
    );
    const report = await reportService.getReport(
      batchRun.courseId,
      batchRun.id,
    );
    expect(report.run).toMatchObject({
      status: CanvasBatchRunStatus.Failed,
      error: expect.stringContaining(status),
    });
    expect(report.run.completedAt).not.toBeNull();
    expect(adapter.putClassicAttemptGrades).not.toHaveBeenCalled();
  });

  it('persists transport initialization failure', async () => {
    const { runner, getAdapter, batchRun } = harness(jest.fn());
    getAdapter.mockRejectedValue(new Error('Connection unavailable'));
    await runner.run(7);
    expect(batchRun.status).toBe(CanvasBatchRunStatus.Failed);
    expect(batchRun.error).toContain('Connection unavailable');
  });

  it.each(['catalog', 'attempt'])(
    'reports a permission failure during %s preflight',
    async (phase) => {
      const { runner, adapter, attempts } = harness(
        jest.fn().mockResolvedValue(evaluation(4)),
      );
      (phase === 'catalog'
        ? adapter.getClassicQuizCatalog
        : adapter.getClassicAttemptSnapshot
      ).mockResolvedValue({ status: LMSApiResponseStatus.Forbidden });
      await runner.run(7);
      expect(JSON.stringify(attempts)).toContain(
        LMSApiResponseStatus.Forbidden,
      );
      expect(attempts[0].status).toBe(CanvasBatchAttemptStatus.Error);
      expect(adapter.putClassicAttemptGrades).not.toHaveBeenCalled();
    },
  );

  it.each(['rejected', 'unknown'])(
    'retains the %s write outcome without retrying',
    async (outcome) => {
      const { runner, adapter, attempts } = harness(
        jest.fn().mockResolvedValue(evaluation(4)),
      );
      adapter.putClassicAttemptGrades.mockResolvedValue({
        outcome,
        message: 'Connection failed',
      });
      await runner.run(7);
      expect(attempts[0].questions[0].error).toContain(outcome);
      expect(adapter.putClassicAttemptGrades).toHaveBeenCalledTimes(1);
      expect(attempts[0].status).toBe(CanvasBatchAttemptStatus.Error);
    },
  );

  it('adds one review comment for flagged questions after prefilling', async () => {
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce(evaluation(4))
      .mockResolvedValueOnce({
        ...evaluation(3),
        humanReviewReason: 'Potentially harmful content.',
      });
    const { runner, attempts, adapter } = harness(evaluate);

    await runner.run(7);

    expect(adapter.putSubmissionComment).toHaveBeenCalledTimes(1);
    expect(adapter.putSubmissionComment).toHaveBeenCalledWith({
      assignmentId: 900,
      userId: 42,
      text: expect.stringContaining(
        'REVIEW REQUIRED (HelpMe AI)\n\nQuestion 2 review reason: Potentially harmful content.',
      ),
    });
    expect(attempts[0].status).toBe(CanvasBatchAttemptStatus.Prefilled);
  });

  it('reports a failed review comment without undoing the prefill', async () => {
    const { runner, attempts, adapter } = harness(
      jest
        .fn()
        .mockResolvedValue({ ...evaluation(4), humanReviewReason: 'Unclear.' }),
    );
    adapter.putSubmissionComment.mockResolvedValue({
      outcome: 'rejected',
      httpStatus: 401,
    });

    await runner.run(7);

    expect(attempts[0].questions[0].status).toBe(
      CanvasBatchQuestionStatus.Posted,
    );
    expect(attempts[0].error).toContain('review comment was not added');
  });

  it('grades a student and sends every question in one Canvas request', async () => {
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce(evaluation(4))
      .mockResolvedValueOnce(evaluation(3));
    const { runner, attempts, adapter } = harness(evaluate);

    await runner.run(7);

    expect(adapter.putSubmissionComment).not.toHaveBeenCalled();
    expect(adapter.putClassicAttemptGrades).toHaveBeenCalledTimes(1);
    expect(adapter.putClassicAttemptGrades).toHaveBeenCalledWith({
      quizId: 55,
      quizSubmissionId: 500,
      attempt: 1,
      questions: [
        { questionId: 101, score: 4, comment: 'Good answer.' },
        { questionId: 102, score: 3, comment: 'Good answer.' },
      ],
    });
    expect(attempts[0].status).toBe(CanvasBatchAttemptStatus.Prefilled);
    expect(
      attempts[0].questions.every(
        (item) => item.status === CanvasBatchQuestionStatus.Posted,
      ),
    ).toBe(true);
  });

  it('writes nothing when any question cannot be graded', async () => {
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce(evaluation(4))
      .mockRejectedValueOnce(new Error('Invalid model response'));
    const { runner, attempts, adapter } = harness(evaluate);

    await runner.run(7);

    expect(adapter.putClassicAttemptGrades).not.toHaveBeenCalled();
    expect(attempts[0].status).toBe(CanvasBatchAttemptStatus.Error);
  });

  it.each([
    ['manual posting is disabled', { postManually: false }],
    ['an instructor grade exists', { liveGrade: { score: 2, comment: '' } }],
  ])('writes nothing when %s', async (_reason, options) => {
    const evaluate = jest.fn().mockResolvedValue(evaluation(4));
    const { runner, adapter } = harness(evaluate, options);

    await runner.run(7);

    expect(adapter.putClassicAttemptGrades).not.toHaveBeenCalled();
  });

  it('does not repeat its own existing Canvas write', async () => {
    const evaluate = jest.fn().mockResolvedValue(evaluation(4));
    const { runner, attempts, adapter } = harness(evaluate, {
      liveGrade: { score: 4, comment: 'Good answer.' },
    });

    await runner.run(7);

    expect(adapter.putClassicAttemptGrades).not.toHaveBeenCalled();
    expect(
      attempts[0].questions.every(
        (item) => item.status === CanvasBatchQuestionStatus.Posted,
      ),
    ).toBe(true);
  });
});
