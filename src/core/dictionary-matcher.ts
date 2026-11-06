import { normalizeTerm } from './normalizer';
import type { DictionaryEntry, MatchResult } from './types';

export interface DictionaryMatcher {
  setDictionary(entries: DictionaryEntry[]): void;
  match(text: string): MatchResult[];
}

/** Characters that continue a word, so `art` does not hit inside `partial` or `art-house`. */
const WORD_CHAR = "[A-Za-z0-9_'\\u2019\\-]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `large language model` -> `large\s+language\s+model` so any spacing in the page matches. */
function termPattern(normalizedTerm: string): string {
  return normalizedTerm.split(' ').map(escapeRegExp).join('[\\s]+');
}

/**
 * Single alternation regex, longest term first. Left-to-right scanning then gives
 * longest-match-wins and non-overlapping hits in one pass.
 *
 * shortcut: one flat regex over every term, fine for a hand-curated dictionary
 * (hundreds of entries); switch to a trie if users import thousands.
 */
export class RegexDictionaryMatcher implements DictionaryMatcher {
  private source: string | null = null;
  private byNormalizedTerm = new Map<string, DictionaryEntry>();

  setDictionary(entries: DictionaryEntry[]): void {
    this.byNormalizedTerm = new Map();
    for (const entry of entries) {
      if (!entry.normalizedTerm || !entry.translation) continue;
      this.byNormalizedTerm.set(entry.normalizedTerm, entry);
    }

    const patterns = [...this.byNormalizedTerm.keys()]
      .sort((a, b) => b.length - a.length)
      .map(termPattern);

    this.source = patterns.length
      ? `(?<!${WORD_CHAR})(?:${patterns.join('|')})(?!${WORD_CHAR})`
      : null;
  }

  match(text: string): MatchResult[] {
    if (!this.source || !text) return [];
    const regex = new RegExp(this.source, 'gi');
    const results: MatchResult[] = [];

    for (const hit of text.matchAll(regex)) {
      const matched = hit[0];
      if (hit.index === undefined) continue;
      const entry = this.byNormalizedTerm.get(normalizeTerm(matched));
      if (!entry) continue;
      results.push({
        start: hit.index,
        end: hit.index + matched.length,
        term: entry.term,
        translation: entry.translation,
      });
    }
    return results;
  }
}
