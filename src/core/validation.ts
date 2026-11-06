import { MAX_TERM_LENGTH } from '../shared/constants';
import { cleanTerm } from './normalizer';

export type TermValidation =
  | { ok: true; term: string }
  | { ok: false; error: string };

export type TranslationValidation =
  | { ok: true; translation: string }
  | { ok: false; error: string };

/** Latin letters, digits, spaces, and punctuation that legitimately lives inside terms. */
const ALLOWED_TERM_CHARS = /^[A-Za-z0-9 \-'’./+#&:]+$/;

export function validateTerm(raw: string): TermValidation {
  const term = cleanTerm(raw ?? '');
  if (!term) return { ok: false, error: 'Select an English word or phrase.' };
  if (term.length > MAX_TERM_LENGTH) {
    return { ok: false, error: `Keep the term under ${MAX_TERM_LENGTH} characters.` };
  }
  if (!/[A-Za-z]/.test(term) || !ALLOWED_TERM_CHARS.test(term)) {
    return { ok: false, error: 'English words only.' };
  }
  return { ok: true, term };
}

export function validateTranslation(raw: string): TranslationValidation {
  const translation = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!translation) return { ok: false, error: 'Chinese meaning is required.' };
  return { ok: true, translation };
}

/** True when the selection sits in something the user is typing into. */
export function isEditableNode(node: Node | null): boolean {
  for (let el = node instanceof Element ? node : node?.parentElement; el; el = el.parentElement) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const editable = el.getAttribute('contenteditable');
    if (editable !== null && editable.toLowerCase() !== 'false') return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
  }
  return false;
}
