import {
  INDIGENOUS_REASON_CODES,
  type EmbeddableQuestionFeedback,
  type GradingProfile,
} from '@koh/common';
import { z } from 'zod';
import { MechanicalFacts } from './deterministic-checks';

export type GradingContract = Pick<
  GradingProfile,
  'policyKind' | 'systemPrompt' | 'allowedScores' | 'reasonCodes'
>;

function profileFeedbackSchema(profile: GradingContract) {
  return z.object({
    score: z.number().refine((score) => profile.allowedScores.includes(score), {
      message: 'Score is not in the course grading profile',
    }),
    comment: z.string().trim().min(1).max(15000),
    reasons: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .refine((reason) => profile.reasonCodes.includes(reason), {
            message: 'Reason is not in the course grading profile',
          }),
      )
      .min(1)
      .max(20),
    needs_human_review: z.boolean(),
  });
}

export function buildSystemPrompt(
  profile: GradingContract,
  rubric?: string | null,
): string {
  const trimmedRubric = rubric?.trim();
  const scoreList = profile.allowedScores.join(', ');
  const reasonList = profile.reasonCodes
    .map((code) => `\`${code}\``)
    .join(', ');
  const sharedRules = [
    `- \`score\` is one of ${scoreList}.`,
    '- `comment` is a non-empty student-facing string.',
    `- \`reasons\` is a non-empty list drawn only from: ${reasonList}.`,
  ];
  const indgRules = [
    '- `meets_requirements` and `proofreading_note` are each used alone, never with another reason, and only at a score of 2.',
    '- Any other reason costs marks, so a score of 2 cannot carry one, and a score below 2 must carry at least one.',
    '- `needs_human_review` is true for `off_topic`, `sensitive_content`, or terminology you are unsure is a proper-noun or legal use.',
  ];
  const rules =
    profile.policyKind === 'indg-reflection'
      ? [...sharedRules, ...indgRules]
      : sharedRules;

  return [
    profile.systemPrompt,
    trimmedRubric,
    '## Output',
    'Return JSON only, no markdown:',
    '',
    '{"score": 0, "comment": "string", "reasons": ["meets_requirements"], "needs_human_review": false}',
    '',
    ...rules,
  ]
    .filter((section) => section && section.length > 0)
    .join('\n\n');
}

const FULL_MARK_REASONS: ReadonlySet<string> = new Set<string>([
  'meets_requirements',
  'proofreading_note',
]);

const DEDUCTION_REASONS: ReadonlySet<string> = new Set<string>(
  INDIGENOUS_REASON_CODES.filter((code) => !FULL_MARK_REASONS.has(code)),
);

const TOO_SHORT_COMMENT =
  'This answer does not meet the sentence requirements noted in the question.';

export type ValidatedGradePayload = Omit<
  EmbeddableQuestionFeedback,
  'maxScore'
>;

export function validateGradePayload(
  raw: unknown,
  profile: GradingContract,
): ValidatedGradePayload {
  const parsed = profileFeedbackSchema(profile).safeParse(raw);
  if (!parsed.success) {
    throw new Error('Grade payload does not match the course grading profile');
  }

  const {
    score,
    comment,
    reasons: rawReasons,
    needs_human_review,
  } = parsed.data;
  const cleanedReasons = [...new Set(rawReasons)];

  if (profile.policyKind !== 'indg-reflection') {
    return {
      score,
      comment,
      reasons: cleanedReasons,
      needsHumanReview: needs_human_review,
    };
  }

  const needsReview =
    needs_human_review ||
    cleanedReasons.includes('off_topic') ||
    cleanedReasons.includes('sensitive_content') ||
    cleanedReasons.includes('terminology_review');

  const fullMarkReason = [...FULL_MARK_REASONS].find((reason) =>
    cleanedReasons.includes(reason),
  );
  if (fullMarkReason && cleanedReasons.length > 1) {
    throw new Error(`${fullMarkReason} cannot be combined with another reason`);
  }

  const hasDeductions = cleanedReasons.some((r) => DEDUCTION_REASONS.has(r));
  const fullMark = Math.max(...profile.allowedScores);
  if (score === fullMark && hasDeductions) {
    throw new Error(
      `score ${score} is not allowed with deduction reasons: ${cleanedReasons.join(', ')}`,
    );
  }
  if (score < fullMark && !hasDeductions) {
    throw new Error(
      `score ${score} requires at least one deduction reason; got: ${cleanedReasons.join(', ')}`,
    );
  }

  return {
    score,
    comment,
    reasons: cleanedReasons,
    needsHumanReview: needsReview,
  };
}

export function buildUserPrompt(
  questionText: string,
  submission: string,
  facts: MechanicalFacts,
  instructions: string | null | undefined,
  profile: GradingContract,
): string {
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
  ];
  if (profile.policyKind === 'indg-reflection') {
    // Course-specific convention stays in code because a profile row cannot express a code-computed check.
    const variantText =
      facts.indigenousCapitalizationVariants.length > 0
        ? facts.indigenousCapitalizationVariants.join(', ')
        : 'none';
    lines.push(`- indigenous_capitalization_variants: ${variantText}`);
  }
  lines.push('Return JSON only.');

  return lines.filter((line) => line.length > 0).join('\n\n');
}

export function postProcessFeedback(
  validated: ValidatedGradePayload,
  facts: MechanicalFacts,
  profile: GradingContract,
): ValidatedGradePayload {
  if (profile.policyKind !== 'indg-reflection') {
    return validated;
  }

  if (!facts.belowMinimum || !profile.reasonCodes.includes('too_short')) {
    return validated;
  }

  const finalScore = Math.min(validated.score, 1);
  const reasons = validated.reasons.includes('too_short')
    ? [...validated.reasons]
    : [
        'too_short',
        ...validated.reasons.filter((reason) => !FULL_MARK_REASONS.has(reason)),
      ];
  const finalComment = `${TOO_SHORT_COMMENT}\n\n${validated.comment}`
    .trim()
    .slice(0, 15000);

  return {
    score: finalScore,
    comment: finalComment,
    reasons,
    needsHumanReview: validated.needsHumanReview,
  };
}
