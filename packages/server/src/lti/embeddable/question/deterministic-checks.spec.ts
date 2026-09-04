import { computeMechanicalFacts } from './deterministic-checks';

describe('computeMechanicalFacts', () => {
  describe('sentenceCount', () => {
    const cases = [
      {
        label: 'basic sentences',
        text: 'First sentence. Second sentence! Third sentence?',
        expected: 3,
      },
      {
        label: 'abbreviations and initials',
        text: 'Dr. Smith visited the U.B.C. campus e.g. yesterday. It was great.',
        expected: 2,
      },
      {
        label: 'decimals',
        text: 'The score was 3.5 out of 5.0 points. Good job.',
        expected: 2,
      },
      {
        label: 'quotes at boundaries',
        text: 'He said, "Hello!" Then he walked away.',
        expected: 2,
      },
      {
        label: 'line breaks',
        text: 'First sentence\nSecond sentence\r\nThird sentence',
        expected: 3,
      },
      {
        label: 'trailing text without punctuation',
        text: 'This is a single sentence without a period at the end',
        expected: 1,
      },
      { label: 'empty text', text: '', expected: 0 },
      { label: 'whitespace only', text: '   \n\t  ', expected: 0 },
    ];

    it.each(cases)('$label', ({ text, expected }) => {
      expect(computeMechanicalFacts(text, 3, 5).sentenceCount).toBe(expected);
    });
  });

  describe('indigenousCapitalizationVariants', () => {
    const cases = [
      {
        label: 'properly capitalized',
        text: 'We recognize Indigenous peoples and their rights.',
        expected: [],
      },
      {
        label: 'lowercase',
        text: 'We recognize indigenous communities across Canada.',
        expected: ['indigenous'],
      },
      {
        label: 'mixed variants',
        text: 'INDIGENOUS and indigenous and indigENOUS.',
        expected: ['INDIGENOUS', 'indigenous', 'indigENOUS'],
      },
    ];

    it.each(cases)('$label', ({ text, expected }) => {
      expect(
        computeMechanicalFacts(text, 3, 5).indigenousCapitalizationVariants,
      ).toEqual(expected);
    });
  });
});
