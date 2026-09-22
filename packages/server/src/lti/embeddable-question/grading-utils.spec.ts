import type { QuestionGradingSettings, ScoreScale } from '@koh/common';
import { computeMechanicalFacts } from './deterministic-check-utils';
import {
  BLANK_REQUIREMENT,
  buildAppliedRequirements,
  effectiveScoreCap,
  GradingConstraintError,
  validateGradePayload,
} from './grading-utils';

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

  it('finds the lowest triggered automatic-check cap', () => {
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
      validateGradePayload({ ...valid, comment: ' ' }, settings),
    ).toThrow(GradingConstraintError);
    expect(() => validateGradePayload('not json', settings)).toThrow(
      GradingConstraintError,
    );
    // Otherwise-valid output whose score is off-grid (not a step on the scale).
    expect(() =>
      validateGradePayload({ ...valid, score: 1.25 }, settings),
    ).toThrow(/not allowed by the score contract/);
    expect(() =>
      validateGradePayload({ ...valid, reasons: [] }, settings),
    ).toThrow(GradingConstraintError);
    expect(() =>
      validateGradePayload(
        { ...valid, human_review_reason: undefined },
        settings,
      ),
    ).toThrow(GradingConstraintError);
    expect(() =>
      validateGradePayload({ ...valid, score: 11 }, settings),
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
      ),
    ).toEqual({
      score: 1,
      comment: 'The rubric is ambiguous here.',
      reasons: ['the rubric can be read two ways'],
      humanReviewReason:
        'The rubric is ambiguous about whether both examples are required.',
    });
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
