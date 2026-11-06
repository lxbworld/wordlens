import { ANNOTATION_ATTR, ANNOTATION_CLASS, STYLE_ELEMENT_ID } from '../shared/constants';
import type { MatchResult } from '../core/types';

/**
 * Split one text node into: original text + annotation span + original text.
 * The matched English stays a plain text node, so the page reads identically
 * and existing links / listeners on the ancestors keep working.
 */
export function annotateTextNode(
  node: Text,
  matches: MatchResult[],
  register: (created: Text) => void,
): boolean {
  const parent = node.parentNode;
  const doc = node.ownerDocument;
  if (!parent || !doc || matches.length === 0) return false;

  const text = node.data;
  const fragment = doc.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue; // defensive: never overlap annotations
    if (match.start > cursor) {
      const before = doc.createTextNode(text.slice(cursor, match.start));
      register(before);
      fragment.appendChild(before);
    }

    const original = doc.createTextNode(text.slice(match.start, match.end));
    register(original);
    fragment.appendChild(original);

    const annotation = doc.createElement('span');
    annotation.className = ANNOTATION_CLASS;
    annotation.setAttribute(ANNOTATION_ATTR, 'true');
    annotation.textContent = `（${match.translation}）`;
    fragment.appendChild(annotation);

    cursor = match.end;
  }

  if (cursor < text.length) {
    const rest = doc.createTextNode(text.slice(cursor));
    register(rest);
    fragment.appendChild(rest);
  }

  parent.replaceChild(fragment, node);
  return true;
}

/** Remove every annotation under `root` and merge the text nodes left behind. */
export function removeAnnotations(root: ParentNode): number {
  const annotations = Array.from(root.querySelectorAll(`[${ANNOTATION_ATTR}]`));
  const touchedParents = new Set<Node>();

  for (const annotation of annotations) {
    const parent = annotation.parentNode;
    annotation.remove();
    if (parent) touchedParents.add(parent);
  }
  for (const parent of touchedParents) parent.normalize();

  return annotations.length;
}

export function injectAnnotationStyles(doc: Document, css: string): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = css;
  (doc.head ?? doc.documentElement).appendChild(style);
}
