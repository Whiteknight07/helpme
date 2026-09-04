const NONTERMINAL_ABBREVIATIONS = new Set([
  'dr.',
  'e.g.',
  'etc.',
  'i.e.',
  'jr.',
  'mr.',
  'mrs.',
  'ms.',
  'prof.',
  'sr.',
  'st.',
  'vs.',
]);

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isPeriodNonterminal(text: string, index: number): boolean {
  if (
    index > 0 &&
    index + 1 < text.length &&
    isDigit(text[index - 1]) &&
    isDigit(text[index + 1])
  ) {
    return true;
  }
  const match = text.slice(0, index + 1).match(/[A-Za-z.]+$/);
  if (!match) return false;
  const token = match[0];
  const lowered = token.toLowerCase();
  if (NONTERMINAL_ABBREVIATIONS.has(lowered)) return true;
  if (/^[A-Za-z]\.$/.test(token)) return true;
  if (/^(?:[A-Za-z]\.){2,}$/.test(token)) return true;
  return false;
}

export function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const length = text.length;
  let start = 0;

  const advanceStart = (pos: number) => {
    while (pos < length && /\s/.test(text[pos])) {
      pos++;
    }
    return pos;
  };

  start = advanceStart(start);
  let index = start;

  while (index < length) {
    const char = text[index];
    if (char === '\r' || char === '\n') {
      let end = index;
      while (end > start && /\s/.test(text[end - 1])) {
        end--;
      }
      if (end > start) {
        spans.push([start, end]);
      }
      while (index < length && (text[index] === '\r' || text[index] === '\n')) {
        index++;
      }
      start = advanceStart(index);
      index = start;
      continue;
    }

    if (char !== '.' && char !== '!' && char !== '?') {
      index++;
      continue;
    }

    let punctuationEnd = index + 1;
    while (
      punctuationEnd < length &&
      (text[punctuationEnd] === '.' ||
        text[punctuationEnd] === '!' ||
        text[punctuationEnd] === '?')
    ) {
      punctuationEnd++;
    }

    if (
      char === '.' &&
      punctuationEnd === index + 1 &&
      isPeriodNonterminal(text, index)
    ) {
      index++;
      continue;
    }

    let boundaryEnd = punctuationEnd;
    while (boundaryEnd < length && `"'’”)]}`.includes(text[boundaryEnd])) {
      boundaryEnd++;
    }

    if (boundaryEnd < length && !/\s/.test(text[boundaryEnd])) {
      index = punctuationEnd;
      continue;
    }

    spans.push([start, boundaryEnd]);
    start = advanceStart(boundaryEnd);
    index = start;
  }

  let end = length;
  while (end > start && /\s/.test(text[end - 1])) {
    end--;
  }
  if (end > start) {
    spans.push([start, end]);
  }

  return spans;
}

export function countSentences(text: string): number {
  return sentenceSpans(text).length;
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
