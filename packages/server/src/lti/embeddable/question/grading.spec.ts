import {
  ALLOWED_INDIGENOUS_SCORES,
  GENERIC_DEFAULT_ALLOWED_SCORES,
  GENERIC_DEFAULT_REASON_CODES,
  GENERIC_DEFAULT_SYSTEM_PROMPT,
  type GradingProfile,
  INDG_DEFAULT_ALLOWED_SCORES,
  INDG_DEFAULT_REASON_CODES,
  INDG_DEFAULT_SYSTEM_PROMPT,
  INDIGENOUS_REASON_CODES,
} from '@koh/common';
import {
  buildSystemPrompt,
  postProcessFeedback,
  validateGradePayload,
  ValidatedGradePayload,
} from './grading';
import { MechanicalFacts } from './deterministic-checks';

type Contract = Pick<
  GradingProfile,
  'policyKind' | 'systemPrompt' | 'allowedScores' | 'reasonCodes'
>;

const indgProfile: Contract = {
  policyKind: 'indg-reflection',
  systemPrompt: 'INDG course system prompt.',
  allowedScores: [...ALLOWED_INDIGENOUS_SCORES],
  reasonCodes: [...INDIGENOUS_REASON_CODES],
};

const genericProfile: Contract = {
  policyKind: 'generic',
  systemPrompt: 'Generic course system prompt.',
  allowedScores: [0, 1, 2, 3],
  reasonCodes: ['meets_requirements', 'needs_review'],
};

const fullLengthFacts: MechanicalFacts = {
  sentenceCount: 3,
  requiredMinimum: 3,
  requiredMaximum: 5,
  belowMinimum: false,
  aboveMaximum: false,
  indigenousCapitalizationVariants: [],
};

const shortFacts: MechanicalFacts = {
  sentenceCount: 1,
  requiredMinimum: 3,
  requiredMaximum: 5,
  belowMinimum: true,
  aboveMaximum: false,
  indigenousCapitalizationVariants: [],
};

describe('Grading Profiles', () => {
  describe('buildSystemPrompt', () => {
    it('includes the shared INDG rules once for INDG defaults and not at all for generic defaults', () => {
      const indgPrompt = buildSystemPrompt(
        {
          policyKind: 'indg-reflection',
          systemPrompt: INDG_DEFAULT_SYSTEM_PROMPT,
          allowedScores: [...INDG_DEFAULT_ALLOWED_SCORES],
          reasonCodes: [...INDG_DEFAULT_REASON_CODES],
        },
        '',
      );
      const genericPrompt = buildSystemPrompt(
        {
          policyKind: 'generic',
          systemPrompt: GENERIC_DEFAULT_SYSTEM_PROMPT,
          allowedScores: [...GENERIC_DEFAULT_ALLOWED_SCORES],
          reasonCodes: [...GENERIC_DEFAULT_REASON_CODES],
        },
        '',
      );
      expect(indgPrompt.split('capitalize the I').length - 1).toBe(1);
      expect(genericPrompt).not.toContain('capitalize the I');
    });
  });

  describe('validateGradePayload', () => {
    it('accepts a configured score and reason the INDG contract would reject', () => {
      const result = validateGradePayload(
        {
          score: 3,
          comment: 'Strong answer with room to grow.',
          reasons: ['needs_review'],
          needs_human_review: false,
        },
        genericProfile,
      );
      expect(result.score).toBe(3);
      expect(result.reasons).toEqual(['needs_review']);
      expect(result.needsHumanReview).toBe(false);
    });

    it('rejects scores and reasons outside the configured contract', () => {
      expect(() =>
        validateGradePayload(
          {
            score: 5,
            comment: 'Out of range score.',
            reasons: ['meets_requirements'],
            needs_human_review: false,
          },
          genericProfile,
        ),
      ).toThrow();
      expect(() =>
        validateGradePayload(
          {
            score: 2,
            comment: 'Unknown reason.',
            reasons: ['indigenous_capitalization'],
            needs_human_review: false,
          },
          genericProfile,
        ),
      ).toThrow();
    });

    it('keeps INDG full-mark exclusivity under the indg-reflection policy', () => {
      expect(() =>
        validateGradePayload(
          {
            score: 2,
            comment: 'Answer has capitalization issues.',
            reasons: ['indigenous_capitalization'],
            needs_human_review: false,
          },
          indgProfile,
        ),
      ).toThrow();
      expect(() =>
        validateGradePayload(
          {
            score: 2,
            comment: 'Meets requirements.',
            reasons: ['meets_requirements', 'proofreading_note'],
            needs_human_review: false,
          },
          indgProfile,
        ),
      ).toThrow();
    });

    it('forces human review for terminology flags under the indg-reflection policy', () => {
      const result = validateGradePayload(
        {
          score: 1,
          comment: 'Check terminology.',
          reasons: ['terminology_review'],
          needs_human_review: false,
        },
        indgProfile,
      );
      expect(result.needsHumanReview).toBe(true);
    });
  });

  describe('postProcessFeedback', () => {
    it('passes a generic result through unchanged even when short', () => {
      const validated: ValidatedGradePayload = {
        score: 3,
        comment: 'Strong answer.',
        reasons: ['needs_review'],
        needsHumanReview: false,
      };
      const result = postProcessFeedback(validated, shortFacts, genericProfile);
      expect(result).toEqual(validated);
    });

    it('caps a short INDG answer at 1 with the fixed sentence comment', () => {
      const validated: ValidatedGradePayload = {
        score: 2,
        comment: 'Answer addressed the question.',
        reasons: ['meets_requirements'],
        needsHumanReview: false,
      };
      const result = postProcessFeedback(validated, shortFacts, indgProfile);
      expect(result.score).toBe(1);
      expect(result.reasons).toContain('too_short');
      expect(result.comment).toContain(
        'This answer does not meet the sentence requirements noted in the question.',
      );
    });

    it('leaves a full-length INDG answer untouched', () => {
      const validated: ValidatedGradePayload = {
        score: 2,
        comment: 'Answer addressed the question.',
        reasons: ['meets_requirements'],
        needsHumanReview: false,
      };
      const result = postProcessFeedback(
        validated,
        fullLengthFacts,
        indgProfile,
      );
      expect(result).toEqual(validated);
    });
  });
});
