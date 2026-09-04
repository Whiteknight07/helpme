/// <reference lib="es2022.intl" />

const sentenceSegmenter = new Intl.Segmenter('en', {
  granularity: 'sentence',
});

// Intl.Segmenter splits title abbreviations (Dr.) and single initials (J.)
// that never end a sentence here, so rejoin those segments.
const NONTERMINAL_END = /\b(?:dr|mr|mrs|ms|prof|jr|sr|st|vs|[a-z])\.$/i;

export function countSentences(text: string): number {
  const segments = [...sentenceSegmenter.segment(text)].map(
    (part) => part.segment,
  );
  const merged: string[] = [];
  for (const segment of segments) {
    const previous: string | undefined = merged[merged.length - 1];
    if (previous !== undefined && NONTERMINAL_END.test(previous.trimEnd())) {
      merged[merged.length - 1] = previous + segment;
    } else {
      merged.push(segment);
    }
  }
  return merged.filter((segment) => segment.trim() !== '').length;
}

export function findIndigenousCapitalizationVariants(text: string): string[] {
  return [
    ...new Set(
      (text.match(/\bIndigenous\b/gi) ?? []).filter(
        (match) => match !== 'Indigenous',
      ),
    ),
  ];
}

export interface MechanicalFacts {
  sentenceCount: number;
  requiredMinimum: number;
  requiredMaximum: number;
  belowMinimum: boolean;
  aboveMaximum: boolean;
  indigenousCapitalizationVariants: string[];
}

export function computeMechanicalFacts(
  submission: string,
  minSentences: number,
  maxSentences: number,
): MechanicalFacts {
  const sentenceCount = countSentences(submission);
  const belowMinimum = sentenceCount < minSentences;
  const aboveMaximum = sentenceCount > maxSentences;
  const indigenousCapitalizationVariants =
    findIndigenousCapitalizationVariants(submission);

  return {
    sentenceCount,
    requiredMinimum: minSentences,
    requiredMaximum: maxSentences,
    belowMinimum,
    aboveMaximum,
    indigenousCapitalizationVariants,
  };
}
