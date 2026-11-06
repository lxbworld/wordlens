/**
 * Leading/trailing characters that are never part of a term.
 * `+` and `#` stay, so terms like `C++` / `C#` survive cleaning.
 */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}+#]+|[^\p{L}\p{N}+#]+$/gu;

/** Matching key. Never store the result over the user's original text. */
export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Collapse whitespace and strip surrounding punctuation, e.g. `(art),` -> `art`. */
export function cleanTerm(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_PUNCTUATION, '')
    .trim();
}
