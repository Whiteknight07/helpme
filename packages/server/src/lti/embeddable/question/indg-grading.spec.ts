import {
  ALLOWED_INDIGENOUS_SCORES,
  INDIGENOUS_REASON_CODES,
  IndigenousReason,
} from '@koh/common';
import {
  buildSystemPrompt,
  buildUserPrompt,
  DEDUCTION_REASONS,
  DEFAULT_RUBRIC,
  GradeParseError,
  LOCKED_PROMPT_PREFIX,
  LOCKED_PROMPT_SUFFIX,
  normalizeScore,
  postProcessFeedback,
  STRICT_SYSTEM_PROMPT,
  TOO_SHORT_COMMENT,
  validateGradePayload,
} from './indg-grading';
import { MechanicalFacts } from './deterministic-checks';

const ORIGINAL_STRICT_SYSTEM_PROMPT = `You are grading one short reflective answer from an Indigenous Studies self-assessment.

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
      expect(normalizeScore('1 garbage')).toBeNull();
      expect(normalizeScore('2.0abc')).toBeNull();
      expect(normalizeScore(null)).toBeNull();
      expect(normalizeScore(undefined)).toBeNull();
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

  describe('buildSystemPrompt', () => {
    it('matches the original full prompt literal byte-for-byte when called with default/no rubric', () => {
      expect(buildSystemPrompt()).toBe(ORIGINAL_STRICT_SYSTEM_PROMPT);
      expect(STRICT_SYSTEM_PROMPT).toBe(ORIGINAL_STRICT_SYSTEM_PROMPT);
    });

    it('interpolates trimmed custom rubric between locked prefix and suffix', () => {
      const customRubric = '## Custom Criteria\n\nCustom rule here.';
      const prompt = buildSystemPrompt(`  ${customRubric}  `);
      expect(prompt).toBe(
        `${LOCKED_PROMPT_PREFIX}\n\n${customRubric}\n\n${LOCKED_PROMPT_SUFFIX}`,
      );
    });

    it('falls back to DEFAULT_RUBRIC when rubric argument is null, undefined, or whitespace', () => {
      expect(buildSystemPrompt(null)).toBe(ORIGINAL_STRICT_SYSTEM_PROMPT);
      expect(buildSystemPrompt(undefined)).toBe(ORIGINAL_STRICT_SYSTEM_PROMPT);
      expect(buildSystemPrompt('   \n\t  ')).toBe(
        ORIGINAL_STRICT_SYSTEM_PROMPT,
      );
      expect(buildSystemPrompt('')).toBe(ORIGINAL_STRICT_SYSTEM_PROMPT);
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
      expect(prompt).not.toContain('Rubric / Criteria');
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
      expect(prompt).not.toContain('Rubric / Criteria');
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

  describe('LOCKED_PROMPT_SUFFIX', () => {
    it('contains every code in INDIGENOUS_REASON_CODES and every value in ALLOWED_INDIGENOUS_SCORES', () => {
      for (const code of INDIGENOUS_REASON_CODES) {
        expect(LOCKED_PROMPT_SUFFIX).toContain(code);
      }
      for (const score of ALLOWED_INDIGENOUS_SCORES) {
        expect(LOCKED_PROMPT_SUFFIX).toContain(String(score));
      }
    });
  });

  describe('DEDUCTION_REASONS', () => {
    it('equals exactly the seven codes it holds today, listed explicitly', () => {
      const expectedCodes: readonly IndigenousReason[] = [
        'blank',
        'too_short',
        'indigenous_capitalization',
        'terminology_review',
        'unreadable',
        'off_topic',
        'sensitive_content',
      ];
      expect(DEDUCTION_REASONS.size).toBe(7);
      expect(DEDUCTION_REASONS).toEqual(new Set(expectedCodes));
      for (const code of expectedCodes) {
        expect(DEDUCTION_REASONS.has(code)).toBe(true);
      }
    });
  });
});
