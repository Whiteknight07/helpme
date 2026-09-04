import {
  countSentences,
  findIndigenousCapitalizationVariants,
  sentenceSpans,
} from './deterministic-checks';

describe('Deterministic checks', () => {
  describe('sentenceSpans and countSentences', () => {
    it('splits basic sentences', () => {
      const text = 'First sentence. Second sentence! Third sentence?';
      const spans = sentenceSpans(text);
      expect(spans).toHaveLength(3);
      expect(countSentences(text)).toBe(3);
    });

    it('handles abbreviations without splitting', () => {
      const text =
        'Dr. Smith visited the U.B.C. campus e.g. yesterday. It was great.';
      const spans = sentenceSpans(text);
      expect(spans).toHaveLength(2);
      expect(countSentences(text)).toBe(2);
    });

    it('handles decimal points without splitting', () => {
      const text = 'The score was 3.5 out of 5.0 points. Good job.';
      expect(countSentences(text)).toBe(2);
    });

    it('handles quotes and closing parentheses at boundaries', () => {
      const text = 'He said, "Hello!" Then he walked away.';
      expect(countSentences(text)).toBe(2);
    });

    it('handles line breaks as sentence boundaries', () => {
      const text = 'First sentence\nSecond sentence\r\nThird sentence';
      expect(countSentences(text)).toBe(3);
    });

    it('counts trailing text without punctuation as a sentence', () => {
      const text = 'This is a single sentence without a period at the end';
      expect(countSentences(text)).toBe(1);
    });

    it('handles empty or whitespace string', () => {
      expect(countSentences('')).toBe(0);
      expect(countSentences('   \n\t  ')).toBe(0);
    });
  });

  describe('findIndigenousCapitalizationVariants', () => {
    it('returns empty array when properly capitalized', () => {
      const text = 'We recognize Indigenous peoples and their rights.';
      expect(findIndigenousCapitalizationVariants(text)).toEqual([]);
    });

    it('detects lowercase indigenous', () => {
      const text = 'We recognize indigenous communities across Canada.';
      expect(findIndigenousCapitalizationVariants(text)).toEqual([
        'indigenous',
      ]);
    });

    it('detects all-caps or mixed-case variants and deduplicates', () => {
      const text = 'INDIGENOUS and indigenous and indigENOUS.';
      const variants = findIndigenousCapitalizationVariants(text);
      expect(variants).toContain('INDIGENOUS');
      expect(variants).toContain('indigenous');
      expect(variants).toContain('indigENOUS');
      expect(variants).toHaveLength(3);
    });
  });
});
