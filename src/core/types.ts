export interface DictionaryEntry {
  id: string;
  /** Original English term exactly as the user entered it. */
  term: string;
  /** Chinese gloss exactly as the user entered it. */
  translation: string;
  /** Matching key: trimmed, lowercased, single spaces. */
  normalizedTerm: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDictionaryEntry {
  term: string;
  translation: string;
}

export interface DictionaryData {
  version: number;
  entries: DictionaryEntry[];
}

/** One hit inside the scanned text. Indices are UTF-16 offsets, like Text.data.slice. */
export interface MatchResult {
  start: number;
  end: number;
  term: string;
  translation: string;
}
