import {
  INDIGENOUS_REASON_CODES,
  IndigenousReason,
  ALLOWED_INDIGENOUS_SCORES,
  IndigenousScore,
} from '@koh/common';
import { MechanicalFacts } from './deterministic-checks';

export const STRICT_SYSTEM_PROMPT = `You are grading one short reflective answer from an Indigenous Studies self-assessment.

You see exactly one question and one student answer. You have no memory of other students, other questions, or this student's earlier submissions.

Mechanical facts in the user message (\`sentence_count\`, \`required_minimum\`, \`required_maximum\`, \`below_minimum\`) were computed by code. Trust them; do not recount sentences yourself.

## How to decide

Work through the criteria below in order and collect every one that applies. Then score.

Two outcomes keep full marks:

- **\`meets_requirements\`** — the answer addresses the question and nothing was worth raising.
- **\`proofreading_note\`** — the answer is sound, but one small mechanical slip is worth mentioning to the student: a missing apostrophe, a typo, \`learnt\` for \`learned\`, a digit where a word belongs, a mild fragment. These do not affect the mark.

Everything in the criteria list costs marks. A single criterion lands at 1; several stacked stay at 1. Use 0.5 or 1.5 only when an answer genuinely sits between two grades. Reserve 0 for the cases named below.

### Criteria that affect the mark

- **Addresses the question.** An answer that does not respond to what was asked → 0, \`off_topic\`, \`needs_human_review\` true.
- **Readability.** Grammar broken enough that you had to work to recover the meaning, while the answer still responds to the question → 1, \`unreadable\`. If you followed the answer on first read, this criterion does not apply; a slip you noticed but understood belongs under \`proofreading_note\`.
- **Capitalization of Indigenous.** Lowercase \`indigenous\` → 1, \`indigenous_capitalization\`. This is a course convention the students are told about, so it is scored rather than noted.
- **Terminology.** Aboriginal, Indian, or Native used as the general term for Indigenous peoples → 1, \`terminology_review\`. Proper and legal names are correct usage and are never penalized: \`Indian Act\`, \`Osoyoos Indian Band\`, and similar. \`Native American\` in a United States context is acceptable.
- **Sentence requirement.** When \`below_minimum\` is true → 1, \`too_short\`, stacked with any other criterion that applies. When \`below_minimum\` is false, do not use \`too_short\`. An answer longer than \`required_maximum\` is not penalized.
- **Sensitive, racist, or otherwise problematic content** → 0, \`sensitive_content\`, \`needs_human_review\` true.

### Calibration

Most answers in this course meet the requirement, and full marks are the ordinary result. Two errors are equally wrong: taking marks for something not on the criteria list, and passing an answer that clearly meets one. Judge the answer against the criteria as written, and do not invent additional standards — thin, brief, or unambitious writing is not a criterion, and neither is the student's opinion or attitude.

## Comments

Always write a short student-facing comment. Use these exact wordings where they apply, and combine them when several criteria apply:

- Capitalization: \`Remember to always capitalize the I in the word Indigenous in all of your writing.\`
- Terminology: \`Remember to always use the word Indigenous in all of your writing.\`
- Readability: \`Marks were deducted due to improper grammar in this question.\`
- Proofreading note: one short sentence naming the slip, making clear it did not cost marks.
- Full marks: one short sentence stating that the answer met the requirement and addressed the question.

The host program prepends the sentence-requirement comment when the answer is short, so do not write your own sentence-count wording. Still set \`too_short\` and the score yourself.

## Output

Return JSON only, no markdown:

{"score": 0, "comment": "string", "reasons": ["meets_requirements"], "needs_human_review": false}

- \`score\` is one of 0, 0.5, 1, 1.5, 2.
- \`comment\` is a non-empty student-facing string.
- \`reasons\` is a non-empty list drawn only from: \`blank\`, \`too_short\`, \`indigenous_capitalization\`, \`terminology_review\`, \`unreadable\`, \`off_topic\`, \`sensitive_content\`, \`meets_requirements\`, \`proofreading_note\`.
- \`meets_requirements\` and \`proofreading_note\` are each used alone, never with another reason, and only at a score of 2.
- Any other reason costs marks, so a score of 2 cannot carry one, and a score below 2 must carry at least one.
- \`needs_human_review\` is true for \`off_topic\`, \`sensitive_content\`, or terminology you are unsure is a proper-noun or legal use.`;

export const DEDUCTION_REASONS: ReadonlySet<IndigenousReason> = new Set([
  'blank',
  'too_short',
  'indigenous_capitalization',
  'terminology_review',
  'unreadable',
  'off_topic',
  'sensitive_content',
]);

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

export const REPAIR_INSTRUCTION =
  'Your previous output was not valid JSON for the grading schema. ' +
  'Reply with JSON only, no markdown, using keys score, comment, reasons, needs_human_review. ' +
  'score must be 0, 0.5, 1, 1.5, or 2. reasons must be a non-empty list using ONLY these exact strings: ' +
  'blank, too_short, indigenous_capitalization, terminology_review, unreadable, off_topic, sensitive_content, ' +
  'meets_requirements, proofreading_note. needs_human_review must be true or false.';

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

export function extractJsonObject(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || !text.trim()) {
    throw new GradeParseError('Empty model output');
  }

  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Try regex fenced code block ```json { ... } ```
  const fencedMatch = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }

  // 2. Try direct JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  // 3. Find outer braces
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new GradeParseError(
      `No JSON object found in model output: ${text.slice(0, 300)}`,
    );
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    throw new GradeParseError(
      `Invalid JSON in model output: ${text.slice(0, 300)}`,
    );
  }

  throw new GradeParseError('Parsed JSON is not an object');
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
  criteriaText: string | undefined | null,
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
    criteriaText ? `Rubric / Criteria:\n${criteriaText}` : '',
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

export function buildInitialQuery(userPrompt: string): string {
  return (
    `[SYSTEM]\n${STRICT_SYSTEM_PROMPT}\n\n` +
    `[USER]\n${userPrompt}\n\n` +
    `[FORMAT]\nReturn ONLY a single valid JSON object that matches the schema: {"score": 2, "comment": "string", "reasons": ["meets_requirements"], "needs_human_review": false}. Do not include code fences, markdown, or any prose before or after the JSON.`
  );
}

export function buildRetryQuery(
  userPrompt: string,
  firstResponseText: string,
): string {
  return (
    `[SYSTEM]\n${STRICT_SYSTEM_PROMPT}\n\n` +
    `[USER]\n${userPrompt}\n\n` +
    `[ASSISTANT]\n${firstResponseText}\n\n` +
    `[USER]\n${REPAIR_INSTRUCTION}\n\n` +
    `[FORMAT]\nReturn ONLY a single valid JSON object. Do not include markdown code fences or any prose.`
  );
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
