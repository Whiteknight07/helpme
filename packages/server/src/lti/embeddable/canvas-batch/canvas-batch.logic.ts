import * as crypto from 'crypto';
import {
  BLANK_ANSWER_COMMENT,
  CanvasBatchQuestionSnapshot,
  CanvasBatchQuestionStatus,
  CanvasBatchQuestionWrite,
  GradingSnapshot,
} from '@koh/common';
import {
  LMSClassicAttemptAnswer,
  LMSClassicQuiz,
} from '../../../lmsIntegration/lmsIntegration.adapter';

/**
 * Pure decision logic for the Classic Canvas batch backend. Everything here is
 * deterministic and side-effect free so the run's behaviour can be tested
 * without a database or a Canvas connection.
 */

/** Stable answer hash used for the preflight compare immediately before a write. */
export function hashAnswer(answer: string): string {
  return crypto.createHash('sha256').update(answer, 'utf8').digest('hex');
}

/** Staff-visible error for an attempt Canvas could not hand us history for. */
export const UNREADABLE_ATTEMPT_ERROR =
  'Canvas did not return usable submission history for this attempt.';
/** Staff-visible error for a mapped question with no answer in the attempt. */
export const MISSING_ANSWER_ERROR =
  'Canvas did not return an answer for this mapped question.';

/** The frozen grading snapshot for one question of a run. */
export function buildGradingSnapshot(
  instruction: string,
  question: CanvasBatchQuestionSnapshot,
): GradingSnapshot {
  return {
    questionText: question.questionText,
    gradingSettings: question.gradingSettings,
    gradingMode: 'final',
    instruction,
  };
}

/** The starting state of one discovered question. */
export interface DiscoveredQuestionState {
  status: CanvasBatchQuestionStatus;
  score: number | null;
  comment: string | null;
  reasons: string[];
  error: string | null;
}

/**
 * Classifies a discovered answer.
 *
 * A missing or unreadable answer is an error, never a blank. A present but
 * whitespace-only answer is a deterministic zero with the fixed comment and no
 * model or flag. A question that already carries a score or comment is left for
 * staff and never regraded.
 */
export function classifyDiscoveredAnswer(
  answer: LMSClassicAttemptAnswer | undefined,
  readable: boolean,
): DiscoveredQuestionState {
  if (!readable) {
    return {
      status: CanvasBatchQuestionStatus.Error,
      score: null,
      comment: null,
      reasons: [],
      error: UNREADABLE_ATTEMPT_ERROR,
    };
  }
  if (!answer) {
    return {
      status: CanvasBatchQuestionStatus.Error,
      score: null,
      comment: null,
      reasons: [],
      error: MISSING_ANSWER_ERROR,
    };
  }
  const hasExistingGrade =
    answer.points != null || (answer.comment ?? '').trim() !== '';
  if (hasExistingGrade) {
    return {
      status: CanvasBatchQuestionStatus.Skipped,
      score: null,
      comment: null,
      reasons: [],
      error: null,
    };
  }
  if (answer.text.trim() === '') {
    return {
      status: CanvasBatchQuestionStatus.Graded,
      score: 0,
      comment: BLANK_ANSWER_COMMENT,
      reasons: ['blank'],
      error: null,
    };
  }
  return {
    status: CanvasBatchQuestionStatus.Pending,
    score: null,
    comment: null,
    reasons: [],
    error: null,
  };
}

/**
 * True when the live quiz catalog no longer matches the frozen mapping: a
 * mapped question is gone, or its content, points, or embed changed. Returns an error string,
 * or null when nothing changed.
 */
export function mappingChangedError(
  quiz: LMSClassicQuiz,
  questions: CanvasBatchQuestionSnapshot[],
): string | null {
  if (quiz.essayQuestions.length !== questions.length) {
    return 'The Canvas quiz questions changed after this run started; nothing was written.';
  }
  for (const question of questions) {
    const catalogQuestion = quiz.essayQuestions.find(
      (candidate) => candidate.id === question.canvasQuestionId,
    );
    if (!catalogQuestion) {
      return `Canvas question ${question.canvasQuestionId} is no longer an essay question of this quiz; nothing was written.`;
    }
    if (
      catalogQuestion.text !== question.text ||
      catalogQuestion.points !== question.canvasPoints ||
      catalogQuestion.mapping.status !== 'detected' ||
      catalogQuestion.mapping.lookupUuid !== question.lookupUuid ||
      catalogQuestion.mapping.embeddableQuestionId !==
        question.embeddableQuestionId
    ) {
      return `Canvas question ${question.canvasQuestionId} changed after this run started; nothing was written.`;
    }
  }
  return null;
}

/** How an existing Canvas grade relates to the write this run is about to make. */
export type ExistingGradeState = 'absent' | 'own' | 'foreign';

/**
 * `own` means the existing score and comment are exactly this run's expected
 * write, so a resume is a no-op. `foreign` means someone else's grade or comment
 * is present and must be left untouched.
 */
export function existingGradeState(
  answer: LMSClassicAttemptAnswer | undefined,
  expected: CanvasBatchQuestionWrite,
): ExistingGradeState {
  if (!answer) {
    return 'foreign';
  }
  const score = answer.points;
  const existingComment = (answer.comment ?? '').trim();
  if (score == null && existingComment === '') {
    return 'absent';
  }
  const scoreMatches = score != null && Math.abs(score - expected.score) < 1e-9;
  const commentMatches = existingComment === expected.comment.trim();
  return scoreMatches && commentMatches ? 'own' : 'foreign';
}
