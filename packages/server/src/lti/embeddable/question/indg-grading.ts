import {
  INDIGENOUS_REASON_CODES,
  IndigenousReason,
  ALLOWED_INDIGENOUS_SCORES,
  IndigenousScore,
  DEFAULT_RUBRIC,
} from '@koh/common';
import { MechanicalFacts } from './deterministic-checks';

export { DEFAULT_RUBRIC };

export function buildSystemPrompt(rubric?: string | null): string {
  const gradingRubric = rubric?.trim() || DEFAULT_RUBRIC;
  return `You are grading one short reflective answer from an Indigenous Studies self-assessment.

You see exactly one question and one student answer. You have no memory of other students, other questions, or this student's earlier submissions.

Mechanical facts in the user message (\`sentence_count\`, \`required_minimum\`, \`required_maximum\`, \`below_minimum\`) were computed by code. Trust them; do not recount sentences yourself.

${gradingRubric}

## Output

Return JSON only, no markdown:

{"score": 0, "comment": "string", "reasons": ["meets_requirements"], "needs_human_review": false}

- \`score\` is one of ${ALLOWED_INDIGENOUS_SCORES.join(', ')}.
- \`comment\` is a non-empty student-facing string.
- \`reasons\` is a non-empty list drawn only from: ${INDIGENOUS_REASON_CODES.map((code) => `\`${code}\``).join(', ')}.
- \`meets_requirements\` and \`proofreading_note\` are each used alone, never with another reason, and only at a score of 2.
- Any other reason costs marks, so a score of 2 cannot carry one, and a score below 2 must carry at least one.
- \`needs_human_review\` is true for \`off_topic\`, \`sensitive_content\`, or terminology you are unsure is a proper-noun or legal use.`;
}

export const STRICT_SYSTEM_PROMPT = buildSystemPrompt();

export const FULL_MARK_REASONS: ReadonlySet<IndigenousReason> =
  new Set<IndigenousReason>(['meets_requirements', 'proofreading_note']);

export const DEDUCTION_REASONS: ReadonlySet<IndigenousReason> =
  new Set<IndigenousReason>(
    INDIGENOUS_REASON_CODES.filter((code) => !FULL_MARK_REASONS.has(code)),
  );

export const TOO_SHORT_COMMENT =
  'This answer does not meet the sentence requirements noted in the question.';

export const REASON_ALIASES: Record<string, IndigenousReason> = {
  grammar: 'unreadable',
  grammar_deduction: 'unreadable',
  'grammar deduction': 'unreadable',
  improper_grammar: 'unreadable',
  poor_grammar: 'unreadable',
  capitalization: 'indigenous_capitalization',
  indigenous_capitalization_variants: 'indigenous_capitalization',
  uncapitalized_indigenous: 'indigenous_capitalization',
  lowercase_indigenous: 'indigenous_capitalization',
  terminology: 'terminology_review',
  wrong_general_term: 'terminology_review',
  'wrong general term': 'terminology_review',
  incorrect_terminology: 'terminology_review',
  proofreading: 'proofreading_note',
  proofreading_reminder: 'proofreading_note',
  minor_proofreading: 'proofreading_note',
  typo: 'proofreading_note',
  spelling: 'proofreading_note',
};

export class GradeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradeParseError';
  }
}

export interface ValidatedGradePayload {
  score: IndigenousScore;
  comment: string;
  reasons: IndigenousReason[];
  needsHumanReview: boolean;
}

export function normalizeScore(val: unknown): IndigenousScore | null {
  if (typeof val === 'boolean' || val === null || val === undefined) {
    return null;
  }
  let num: number;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    num = Number(trimmed);
  } else {
    return null;
  }
  if (!Number.isFinite(num)) return null;
  if ((ALLOWED_INDIGENOUS_SCORES as readonly number[]).includes(num)) {
    return num as IndigenousScore;
  }
  return null;
}

export function validateGradePayload(raw: unknown): ValidatedGradePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GradeParseError('Grade payload must be an object');
  }
  const obj = raw as Record<string, unknown>;

  const score = normalizeScore(obj.score);
  if (score === null) {
    throw new GradeParseError(
      `score must be 0, 0.5, 1, 1.5, or 2; got ${JSON.stringify(obj.score)}`,
    );
  }

  const comment = obj.comment;
  if (typeof comment !== 'string' || !comment.trim()) {
    throw new GradeParseError('comment must be a non-empty string');
  }
  const boundedComment = comment.trim().slice(0, 15000);

  const rawReasons = obj.reasons;
  if (
    !Array.isArray(rawReasons) ||
    rawReasons.length === 0 ||
    rawReasons.length > 20
  ) {
    throw new GradeParseError(
      'reasons must be a non-empty list of at most 20 items',
    );
  }

  const cleanedReasons: IndigenousReason[] = [];
  for (const r of rawReasons) {
    if (typeof r !== 'string' || !r.trim() || r.length > 200) {
      throw new GradeParseError(`Unknown reason value: ${JSON.stringify(r)}`);
    }
    const key = r.trim().toLowerCase();
    const normalized = (REASON_ALIASES[key] ?? key) as IndigenousReason;
    if (!INDIGENOUS_REASON_CODES.includes(normalized)) {
      throw new GradeParseError(`Unknown reason code: ${JSON.stringify(r)}`);
    }
    if (!cleanedReasons.includes(normalized)) {
      cleanedReasons.push(normalized);
    }
  }

  const rawNeedsReview = obj.needs_human_review ?? obj.needsHumanReview;
  if (typeof rawNeedsReview !== 'boolean') {
    throw new GradeParseError('needs_human_review must be a boolean');
  }

  let needsReview = rawNeedsReview;
  if (
    cleanedReasons.includes('off_topic') ||
    cleanedReasons.includes('sensitive_content') ||
    cleanedReasons.includes('terminology_review')
  ) {
    needsReview = true;
  }

  if (
    cleanedReasons.includes('meets_requirements') &&
    cleanedReasons.length > 1
  ) {
    throw new GradeParseError(
      'meets_requirements cannot be combined with another reason',
    );
  }
  if (
    cleanedReasons.includes('proofreading_note') &&
    cleanedReasons.length > 1
  ) {
    throw new GradeParseError(
      'proofreading_note cannot be combined with another reason',
    );
  }

  const hasDeductions = cleanedReasons.some((r) => DEDUCTION_REASONS.has(r));
  if (score === 2 && hasDeductions) {
    throw new GradeParseError(
      `score 2 is not allowed with deduction reasons: ${cleanedReasons.join(', ')}`,
    );
  }
  if (score < 2 && !hasDeductions) {
    throw new GradeParseError(
      `score ${score} requires at least one deduction reason; got: ${cleanedReasons.join(', ')}`,
    );
  }

  return {
    score,
    comment: boundedComment,
    reasons: cleanedReasons,
    needsHumanReview: needsReview,
  };
}

export function buildUserPrompt(
  questionText: string,
  submission: string,
  facts: MechanicalFacts,
  instructions?: string | null,
): string {
  const variantText =
    facts.indigenousCapitalizationVariants.length > 0
      ? facts.indigenousCapitalizationVariants.join(', ')
      : 'none';

  const lines = [
    `Question:\n${questionText}`,
    instructions ? `Instructions:\n${instructions}` : '',
    `Student answer:\n${submission}`,
    'Mechanical facts (computed by code, not by you):',
    `- sentence_count: ${facts.sentenceCount}`,
    `- required_minimum: ${facts.requiredMinimum}`,
    `- required_maximum: ${facts.requiredMaximum}`,
    `- below_minimum: ${facts.belowMinimum}`,
    `- above_maximum: ${facts.aboveMaximum}`,
    `- indigenous_capitalization_variants: ${variantText}`,
    'Return JSON only.',
  ].filter(Boolean);

  return lines.join('\n\n');
}

export interface PostProcessedFeedback {
  score: IndigenousScore;
  comment: string;
  reasons: IndigenousReason[];
  needsHumanReview: boolean;
}

export function postProcessFeedback(
  validated: ValidatedGradePayload,
  facts: MechanicalFacts,
): PostProcessedFeedback {
  let finalScore = validated.score;
  const reasons = [...validated.reasons];
  let finalComment = validated.comment;

  if (facts.belowMinimum) {
    finalScore = Math.min(1, finalScore) as IndigenousScore;
    if (!reasons.includes('too_short')) {
      const meetsIdx = reasons.indexOf('meets_requirements');
      if (meetsIdx !== -1) reasons.splice(meetsIdx, 1);
      const proofIdx = reasons.indexOf('proofreading_note');
      if (proofIdx !== -1) reasons.splice(proofIdx, 1);
      reasons.unshift('too_short');
    }
    finalComment = `${TOO_SHORT_COMMENT}\n\n${validated.comment}`
      .trim()
      .slice(0, 15000);
  }

  const needsHumanReview =
    validated.needsHumanReview ||
    reasons.includes('off_topic') ||
    reasons.includes('sensitive_content') ||
    reasons.includes('terminology_review');

  return {
    score: finalScore,
    comment: finalComment,
    reasons,
    needsHumanReview,
  };
}
