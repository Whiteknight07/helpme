import {
  countSentences,
  findIndigenousCapitalizationVariants,
} from './deterministic-checks';

describe('Deterministic checks', () => {
  describe('countSentences', () => {
    const cases: [string, string, number][] = [
      [
        'basic sentences',
        'First sentence. Second sentence! Third sentence?',
        3,
      ],
      [
        'abbreviations and initials',
        'Dr. Smith visited the U.B.C. campus e.g. yesterday. It was great.',
        2,
      ],
      ['decimals', 'The score was 3.5 out of 5.0 points. Good job.', 2],
      ['quotes at boundaries', 'He said, "Hello!" Then he walked away.', 2],
      ['line breaks', 'First sentence\nSecond sentence\r\nThird sentence', 3],
      [
        'trailing text without punctuation',
        'This is a single sentence without a period at the end',
        1,
      ],
      ['empty text', '', 0],
      ['whitespace only', '   \n\t  ', 0],
    ];

    it.each(cases)('%s', (_label, text, expected) => {
      expect(countSentences(text)).toBe(expected);
    });
  });

  describe('findIndigenousCapitalizationVariants', () => {
    const cases: [string, string, string[]][] = [
      [
        'properly capitalized',
        'We recognize Indigenous peoples and their rights.',
        [],
      ],
      [
        'lowercase',
        'We recognize indigenous communities across Canada.',
        ['indigenous'],
      ],
      [
        'mixed variants',
        'INDIGENOUS and indigenous and indigENOUS.',
        ['INDIGENOUS', 'indigenous', 'indigENOUS'],
      ],
    ];

    it.each(cases)('%s', (_label, text, expected) => {
      expect(findIndigenousCapitalizationVariants(text)).toEqual(expected);
    });
  });
});
