import { compileAlias } from "./aliases";
import type { Concept } from "./types";

export interface ConceptMatch {
  text: string;
  start: number;
  end: number;
  /** More than one concept means the term is ambiguous and needs a choice. */
  concepts: Concept[];
}

/**
 * Finds the term under the cursor and every concept that claims it. Concepts
 * sharing a term — “product” as a set, space, or category construction — are
 * grouped into one match so the caller can ask which one was meant.
 */
export function findConceptMatch(
  line: string,
  cursorCh: number,
  concepts: Concept[],
  caseSensitive: boolean
): ConceptMatch | undefined {
  const matches: ConceptMatch[] = [];

  for (const concept of concepts) {
    for (const term of [concept.name, ...concept.aliases]) {
      const pattern = compileAlias(term, caseSensitive);
      if (!pattern) continue;
      for (const { start, end } of pattern.findSpans(line)) {
        if (cursorCh < start || cursorCh > end) continue;
        if (pattern.requiresWordBoundaries && !hasWordBoundaries(line, start, end)) continue;

        const existing = matches.find((match) => match.start === start && match.end === end);
        if (existing) {
          if (!existing.concepts.includes(concept)) existing.concepts.push(concept);
          continue;
        }
        matches.push({ text: line.slice(start, end), start, end, concepts: [concept] });
      }
    }
  }

  return matches.sort((a, b) => b.text.length - a.text.length)[0];
}

export function hasWordBoundaries(line: string, start: number, end: number): boolean {
  const word = /[\p{L}\p{N}_]/u;
  return !(start > 0 && word.test(line[start - 1]))
    && !(end < line.length && word.test(line[end]));
}

export function insideWikiLink(line: string, position: number): boolean {
  const opening = line.lastIndexOf("[[", position);
  const closing = line.lastIndexOf("]]", position);
  return opening > closing;
}
