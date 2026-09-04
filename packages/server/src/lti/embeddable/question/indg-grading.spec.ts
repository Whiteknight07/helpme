import {
  buildSystemPrompt,
  buildUserPrompt,
  DEFAULT_RUBRIC,
  postProcessFeedback,
  TOO_SHORT_COMMENT,
  validateGradePayload,
} from './indg-grading';
import { MechanicalFacts } from './deterministic-checks';

describe('INDG Grading Logic', () => {
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

    it('forces needsHumanReview to true for off_topic, sensitive_content, or terminology_review', () => {
      const offTopic = validateGradePayload({
        score: 0,
        comment: 'Off topic response.',
        reasons: ['off_topic'],
        needs_human_review: false,
      });
      expect(offTopic.needsHumanReview).toBe(true);

      const sensitive = validateGradePayload({
        score: 0,
        comment: 'Sensitive content detected.',
        reasons: ['sensitive_content'],
        needs_human_review: false,
      });
      expect(sensitive.needsHumanReview).toBe(true);

      const terminology = validateGradePayload({
        score: 1,
        comment: 'Check terminology.',
        reasons: ['terminology_review'],
        needs_human_review: false,
      });
      expect(terminology.needsHumanReview).toBe(true);
    });

    it('rejects score 2 combined with deduction reasons', () => {
      const raw = {
        score: 2,
        comment: 'Answer has capitalization issues.',
        reasons: ['indigenous_capitalization'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow();
    });

    it('rejects score below 2 without deduction reasons', () => {
      const raw = {
        score: 1,
        comment: 'Looks fine.',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow();
    });

    it('rejects meets_requirements combined with another reason', () => {
      const raw = {
        score: 2,
        comment: 'Meets requirements.',
        reasons: ['meets_requirements', 'proofreading_note'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow();
    });

    it('rejects unknown reasons', () => {
      const raw = {
        score: 1,
        comment: 'Something else.',
        reasons: ['completely_made_up_reason'],
        needs_human_review: false,
      };
      expect(() => validateGradePayload(raw)).toThrow();
    });
  });

  describe('buildSystemPrompt', () => {
    it('substitutes a trimmed custom rubric into the prompt', () => {
      const customRubric = '## Custom Criteria\n\nCustom rule here.';
      const prompt = buildSystemPrompt(`  ${customRubric}  `);
      expect(prompt).toContain(customRubric);
      expect(prompt).not.toContain(`  ${customRubric}  `);
    });

    it('falls back to DEFAULT_RUBRIC when rubric is empty', () => {
      expect(buildSystemPrompt()).toContain(DEFAULT_RUBRIC);
      expect(buildSystemPrompt(null)).toBe(buildSystemPrompt());
      expect(buildSystemPrompt('   \n\t  ')).toBe(buildSystemPrompt());
    });
  });

  describe('buildUserPrompt', () => {
    it('includes question, submission, mechanical facts, and instructions when provided', () => {
      const facts: MechanicalFacts = {
        sentenceCount: 3,
        requiredMinimum: 3,
        requiredMaximum: 5,
        belowMinimum: false,
        aboveMaximum: false,
        indigenousCapitalizationVariants: [],
      };
      const prompt = buildUserPrompt(
        'Question text here',
        'Student answer here.',
        facts,
        'Grade leniently on minor spelling.',
      );
      expect(prompt).toContain('Question:\nQuestion text here');
      expect(prompt).toContain(
        'Instructions:\nGrade leniently on minor spelling.',
      );
      expect(prompt).toContain('Student answer:\nStudent answer here.');
      expect(prompt).toContain('- sentence_count: 3');
    });

    it('omits instructions when not provided and never includes Rubric / Criteria', () => {
      const facts: MechanicalFacts = {
        sentenceCount: 3,
        requiredMinimum: 3,
        requiredMaximum: 5,
        belowMinimum: false,
        aboveMaximum: false,
        indigenousCapitalizationVariants: [],
      };
      const prompt = buildUserPrompt(
        'Question text here',
        'Student answer here.',
        facts,
        undefined,
      );
      expect(prompt).not.toContain('Instructions:');
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
      expect(result.comment).toBe('Answer addressed the question.');
      expect(result.reasons).toEqual(['meets_requirements']);
    });

    it('bounds final comment to 15000 characters when prepending too short comment', () => {
      const longComment = 'A'.repeat(15000);
      const validated = {
        score: 2 as const,
        comment: longComment,
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
      expect(result.comment.length).toBe(15000);
      expect(result.comment.startsWith(TOO_SHORT_COMMENT)).toBe(true);
    });
  });
});
