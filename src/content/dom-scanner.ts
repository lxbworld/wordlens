import { ANNOTATION_ATTR, UI_HOST_ID } from '../shared/constants';

/** Elements whose text must never be annotated. */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CODE',
  'PRE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'TEMPLATE',
]);

/** True for the extension's own DOM (annotations, toolbar host). */
export function isWordLensNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || typeof element.closest !== 'function') return false;
  return Boolean(element.closest(`[${ANNOTATION_ATTR}], #${UI_HOST_ID}`));
}

function isContentEditable(element: Element): boolean {
  // jsdom does not implement isContentEditable, so read the attribute too.
  const attribute = element.getAttribute('contenteditable');
  if (attribute !== null && attribute.toLowerCase() !== 'false') return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function isSkippedElement(element: Element): boolean {
  if (element.id === UI_HOST_ID) return true;
  if (element.hasAttribute(ANNOTATION_ATTR)) return true;
  if (SKIP_TAGS.has(element.tagName.toUpperCase())) return true;
  return isContentEditable(element);
}

/**
 * Depth-first walk over text nodes of `root`, skipping subtrees that must stay untouched.
 * Rejecting an element prunes its whole subtree, so `code`/`pre` cost nothing.
 *
 * Returns a snapshot: annotating a node during the walk detaches it, which stops the
 * walker, so callers must not mutate while collecting.
 */
export function collectTextNodes(root: Node): Text[] {
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (!doc) return [];

  if (root.nodeType === Node.TEXT_NODE) return [root as Text];

  const found: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return isSkippedElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node as Text);
  }
  return found;
}
