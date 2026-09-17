import type { QuestionGradingSettings, ScoreScale } from '@koh/common';
import { computeMechanicalFacts } from './deterministic-checks';
import {
  BLANK_REQUIREMENT,
  buildAppliedRequirements,
  buildSystemPrompt,
  buildUserPrompt,
  effectiveScoreCap,
  GradingConstraintError,
  HUMAN_REVIEW_REASON_MAX_LENGTH,
  validateGradePayload,
} from './grading';

function makeSettings(
  overrides: Partial<QuestionGradingSettings> = {},
): QuestionGradingSettings {
  return {
    rubric: 'Award points for an accurate and supported answer.',
    feedbackInstructions: 'Keep feedback concise and constructive.',
    scoreScale: { max: 2, step: 0.5 },
    checks: [
      { kind: 'minimum_sentences', minimum: 3, scoreCap: 1 },
      { kind: 'capitalization', term: 'Example', scoreCap: null },
    ],
    ...overrides,
  };
}

const facts = (submission: string, settings = makeSettings()) =>
  computeMechanicalFacts(submission, settings.checks);

describe('question grading contract', () => {
  it.each<ScoreScale>([
    { max: 2, step: 0.5 },
    { max: 10, step: 0.25 },
    { max: 100, step: 1 },
  ])('accepts scores from a question-owned scale: %j', (scoreScale) => {
    const score = scoreScale.step;
    expect(
      validateGradePayload(
        {
          score,
          comment: 'Good answer.',
          reasons: [
            'The response did not address the second required step of the rubric, so it lost that credit.',
          ],
          human_review_reason: null,
        },
        makeSettings({ scoreScale, checks: [] }),
        null,
      ),
    ).toEqual({
      score,
      comment: 'Good answer.',
      reasons: [
        'The response did not address the second required step of the rubric, so it lost that credit.',
      ],
      humanReviewReason: null,
    });
  });

  it('applies the lowest triggered cap: rejects above it and accepts at it', () => {
    const capSettings = makeSettings({
      checks: [
        { kind: 'capitalization', term: 'Indigenous', scoreCap: 1 },
        { kind: 'capitalization', term: 'Example', scoreCap: null },
      ],
    });
    expect(
      effectiveScoreCap(
        facts('the indigenous example.', capSettings).triggeredChecks,
      ),
    ).toBe(1);

    const longSettings = makeSettings({
      checks: [{ kind: 'maximum_sentences', maximum: 2, scoreCap: 1 }],
    });
    const long = facts('One. Two. Three.', longSettings);
    expect(
      long.triggeredChecks.some((check) => check.kind === 'maximum_sentences'),
    ).toBe(true);
    expect(effectiveScoreCap(long.triggeredChecks)).toBe(1);

    const aboveCap = {
      score: 2,
      comment: 'Good answer.',
      reasons: ['off topic'],
      human_review_reason: null,
    };
    const atCap = {
      score: 1,
      comment: 'Good answer.',
      reasons: ['mostly complete'],
      human_review_reason: null,
    };
    expect(() => validateGradePayload(aboveCap, capSettings, 1)).toThrow(
      /effective cap of 1/,
    );
    expect(() => validateGradePayload(aboveCap, longSettings, 1)).toThrow(
      /effective cap of 1/,
    );
    expect(validateGradePayload(atCap, capSettings, 1).score).toBe(1);
  });

  it('rejects malformed output and disallowed scores', () => {
    const settings = makeSettings({ checks: [] });
    const valid = {
      score: 1,
      comment: 'Good answer.',
      reasons: ['complete'],
      human_review_reason: null,
    };
    expect(() =>
      validateGradePayload({ ...valid, comment: ' ' }, settings, null),
    ).toThrow(GradingConstraintError);
    expect(() => validateGradePayload('not json', settings, null)).toThrow(
      GradingConstraintError,
    );
    // Otherwise-valid output whose score is off-grid (not a step on the scale).
    expect(() =>
      validateGradePayload({ ...valid, score: 1.25 }, settings, null),
    ).toThrow(/not allowed by the score contract/);
    expect(() =>
      validateGradePayload({ ...valid, reasons: [] }, settings, null),
    ).toThrow(GradingConstraintError);
    expect(() =>
      validateGradePayload(
        { ...valid, human_review_reason: undefined },
        settings,
        null,
      ),
    ).toThrow(GradingConstraintError);
    expect(() =>
      validateGradePayload({ ...valid, score: 11 }, settings, null),
    ).toThrow(/not allowed by the score contract/);
  });

  it('maps a human review reason to camelCase', () => {
    expect(
      validateGradePayload(
        {
          score: 1,
          comment: 'The rubric is ambiguous here.',
          reasons: ['the rubric can be read two ways'],
          human_review_reason:
            '  The rubric is ambiguous about whether both examples are required.  ',
        },
        makeSettings({ checks: [] }),
        null,
      ),
    ).toEqual({
      score: 1,
      comment: 'The rubric is ambiguous here.',
      reasons: ['the rubric can be read two ways'],
      humanReviewReason:
        'The rubric is ambiguous about whether both examples are required.',
    });
  });

  it('accepts a null reason and rejects a missing or blank reason', () => {
    const settings = makeSettings({ checks: [] });
    const base = {
      score: 1,
      comment: 'Good answer.',
      reasons: ['complete'],
    };
    expect(
      validateGradePayload(
        { ...base, human_review_reason: null },
        settings,
        null,
      ).humanReviewReason,
    ).toBeNull();
    expect(() => validateGradePayload(base, settings, null)).toThrow(
      GradingConstraintError,
    );
    expect(() =>
      validateGradePayload(
        { ...base, human_review_reason: '   ' },
        settings,
        null,
      ),
    ).toThrow(GradingConstraintError);
  });

  it('rejects an empty human review reason', () => {
    const settings = makeSettings({ checks: [] });
    const valid = {
      score: 1,
      comment: 'Good answer.',
      reasons: ['complete'],
      human_review_reason: null,
    };
    expect(() =>
      validateGradePayload(
        { ...valid, human_review_reason: undefined },
        settings,
        null,
      ),
    ).toThrow(GradingConstraintError);
    expect(() =>
      validateGradePayload(
        { ...valid, human_review_reason: '   ' },
        settings,
        null,
      ),
    ).toThrow(GradingConstraintError);
  });

  it('bounds the human review reason length', () => {
    const settings = makeSettings({ checks: [] });
    const flagged = (human_review_reason: string) => ({
      score: 1,
      comment: 'Good answer.',
      reasons: ['complete'],
      human_review_reason,
    });
    expect(
      validateGradePayload(
        flagged('x'.repeat(HUMAN_REVIEW_REASON_MAX_LENGTH)),
        settings,
        null,
      ).humanReviewReason,
    ).toHaveLength(HUMAN_REVIEW_REASON_MAX_LENGTH);
    expect(() =>
      validateGradePayload(
        flagged('x'.repeat(HUMAN_REVIEW_REASON_MAX_LENGTH + 1)),
        settings,
        null,
      ),
    ).toThrow(GradingConstraintError);
  });

  it('guides review flags to material issues and away from reminders and low scores', () => {
    const prompt = buildSystemPrompt(makeSettings(), 1);
    expect(prompt).toContain('material interpretive ambiguity');
    expect(prompt).toContain('genuinely off-topic');
    expect(prompt).toContain('potentially harmful content');
    expect(prompt).toContain(
      'Do not request human review for grammar, capitalization, or sentence-count reminders, for a low score on its own',
    );
    expect(prompt).toContain(
      'A student’s viewpoint, opinion, or lived experience is not a fault',
    );
    expect(prompt).toContain('human_review_reason');
  });

  it('treats proper names of legislation and tests as names of things, not labels for people', () => {
    const prompt = buildSystemPrompt(makeSettings(), 1);
    expect(prompt).toContain('Indian Act');
    expect(prompt).toContain('Native American Implicit Association Test');
    expect(prompt).toContain('are names of things, not labels for people');
    expect(prompt).toContain('do not treat them as harmful content');
  });

  it('forbids implying that a reminder-only check caused a deduction', () => {
    const prompt = buildSystemPrompt(makeSettings(), 1);
    expect(prompt).toContain(
      'do not describe it as a fault or as a cause of lost credit in the comment or in any reason',
    );
  });

  it('passes caller-supplied data into the prompts', () => {
    const settings = makeSettings();
    expect(buildSystemPrompt(settings, 1)).toContain(
      'Award points for an accurate and supported answer.',
    );
    const submission = 'One. Two. Three.';
    expect(
      buildUserPrompt('Explain.', submission, facts(submission, settings)),
    ).toContain(JSON.stringify(submission));
  });

  it('builds deterministic requirement notes separate from the model comment', () => {
    const settings = makeSettings();
    expect(
      buildAppliedRequirements(
        facts('example.', settings).triggeredChecks,
        false,
      ),
    ).toEqual([
      'Score capped at 1: the answer is below the 3-sentence minimum.',
      'Reminder only: uses of "Example" must be capitalized exactly like that; no score cap was applied.',
    ]);
    expect(buildAppliedRequirements([], false)).toEqual([]);
    expect(buildAppliedRequirements([], true)).toEqual([BLANK_REQUIREMENT]);
  });
});
