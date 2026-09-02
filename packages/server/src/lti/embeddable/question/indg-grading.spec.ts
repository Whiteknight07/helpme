import {
  extractJsonObject,
  GradeParseError,
  normalizeScore,
  postProcessFeedback,
  validateGradePayload,
} from './indg-grading';
import { MechanicalFacts } from './deterministic-checks';

describe('INDG Grading Logic', () => {
  describe('normalizeScore', () => {
    it('accepts valid score numbers', () => {
      expect(normalizeScore(0)).toBe(0);
      expect(normalizeScore(0.5)).toBe(0.5);
      expect(normalizeScore(1)).toBe(1);
      expect(normalizeScore(1.5)).toBe(1.5);
      expect(normalizeScore(2)).toBe(2);
    });

    it('accepts valid string numbers', () => {
      expect(normalizeScore('0')).toBe(0);
      expect(normalizeScore('0.5')).toBe(0.5);
      expect(normalizeScore(' 1 ')).toBe(1);
      expect(normalizeScore('1.5')).toBe(1.5);
      expect(normalizeScore('2.0')).toBe(2);
    });

    it('rejects invalid scores', () => {
      expect(normalizeScore(3)).toBeNull();
      expect(normalizeScore(-1)).toBeNull();
      expect(normalizeScore(0.75)).toBeNull();
      expect(normalizeScore(true)).toBeNull();
      expect(normalizeScore(false)).toBeNull();
      expect(normalizeScore('abc')).toBeNull();
      expect(normalizeScore(null)).toBeNull();
      expect(normalizeScore(undefined)).toBeNull();
    });
  });

  describe('extractJsonObject', () => {
    it('parses direct JSON string', () => {
      const jsonStr =
        '{"score": 2, "comment": "Good job", "reasons": ["meets_requirements"], "needs_human_review": false}';
      expect(extractJsonObject(jsonStr)).toEqual({
        score: 2,
        comment: 'Good job',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      });
    });

    it('strips <think> tags and markdown fences', () => {
      const text =
        '<think>Let me evaluate this carefully.</think>```json\n{"score": 1, "comment": "Capitalize Indigenous", "reasons": ["indigenous_capitalization"], "needs_human_review": false}\n```';
      expect(extractJsonObject(text)).toEqual({
        score: 1,
        comment: 'Capitalize Indigenous',
        reasons: ['indigenous_capitalization'],
        needs_human_review: false,
      });
    });

    it('finds JSON with surrounding conversational prose', () => {
      const text =
        'Here is my feedback:\n{"score": 2, "comment": "Great answer", "reasons": ["meets_requirements"], "needs_human_review": false}\nHope that helps!';
      expect(extractJsonObject(text)).toEqual({
        score: 2,
        comment: 'Great answer',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      });
    });

    it('throws GradeParseError for non-JSON text', () => {
      expect(() => extractJsonObject('No JSON here at all')).toThrow(
        GradeParseError,
      );
    });
  });

  describe('validateGradePayload', () => {
    it('validates a valid score 2 meets_requirements payload', () => {
      const raw = {
        score: 2,
        comment: 'Answer meets all requirements.',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      };
      const result = validateGradePayload(raw);
      expect(result.score).toBe(2);
      expect(result.comment).toBe('Answer meets all requirements.');
      expect(result.reasons).toEqual(['meets_requirements']);
      expect(result.needsHumanReview).toBe(false);
    });

    it('validates and normalizes aliases in deduction reasons', () => {
      const raw = {
        score: 1,
        comment: 'Please check grammar.',
        reasons: ['grammar', 'capitalization'],
        needs_human_review: false,
      };
      const result = validateGradePayload(raw);
      expect(result.score).toBe(1);
      expect(result.reasons).toEqual([
        'unreadable',
        'indigenous_capitalization',
      ]);
    });

    it('rejects score 2 combined with deduction reasons', () => {
      const raw = {
        score: 2,
        comment: 'Answer has capitalization issues.',
        reasons: ['indigenous_capitalization'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow(GradeParseError);
    });

    it('rejects score below 2 without deduction reasons', () => {
      const raw = {
        score: 1,
        comment: 'Looks fine.',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow(GradeParseError);
    });

    it('rejects meets_requirements combined with another reason', () => {
      const raw = {
        score: 2,
        comment: 'Meets requirements.',
        reasons: ['meets_requirements', 'proofreading_note'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow(GradeParseError);
    });

    it('rejects unknown reasons', () => {
      const raw = {
        score: 1,
        comment: 'Something else.',
        reasons: ['completely_made_up_reason'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow(GradeParseError);
    });
  });

  describe('postProcessFeedback', () => {
    it('applies score cap and prepends canned sentence comment when below_minimum is true', () => {
      const validated = {
        score: 2 as const,
        comment: 'Answer addressed the question.',
        reasons: ['meets_requirements' as const],
        needsHumanReview: false,
      };
      const facts: MechanicalFacts = {
        sentenceCount: 1,
        requiredMinimum: 3,
        requiredMaximum: 5,
        belowMinimum: true,
        aboveMaximum: false,
        indigenousCapitalizationVariants: [],
      };

      const result = postProcessFeedback(validated, facts);
      expect(result.score).toBe(1);
      expect(result.llmScore).toBe(2);
      expect(result.reasons).toContain('too_short');
      expect(result.comment).toContain(
        'This answer does not meet the sentence requirements noted in the question.',
      );
      expect(result.comment).toContain('Answer addressed the question.');
    });

    it('preserves score and comment when below_minimum is false', () => {
      const validated = {
        score: 2 as const,
        comment: 'Answer addressed the question.',
        reasons: ['meets_requirements' as const],
        needsHumanReview: false,
      };
      const facts: MechanicalFacts = {
        sentenceCount: 4,
        requiredMinimum: 3,
        requiredMaximum: 5,
        belowMinimum: false,
        aboveMaximum: false,
        indigenousCapitalizationVariants: [],
      };

      const result = postProcessFeedback(validated, facts);
      expect(result.score).toBe(2);
      expect(result.llmScore).toBe(2);
      expect(result.comment).toBe('Answer addressed the question.');
      expect(result.reasons).toEqual(['meets_requirements']);
    });
  });
});
