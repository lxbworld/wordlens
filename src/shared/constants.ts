/** Everything the content script and the popup agree on. */

/** Single key in chrome.storage.local that holds the whole dictionary document. */
export const STORAGE_KEY = 'wordlens.dictionary';

/** Bumped when the stored shape changes; migrations hook into this. */
export const DICTIONARY_VERSION = 1;

export const ANNOTATION_CLASS = 'wordlens-annotation';
export const ANNOTATION_ATTR = 'data-wordlens-annotation';

/** Host element of the toolbar / editor shadow root. */
export const UI_HOST_ID = 'wordlens-ui-root';
/** Injected <style> element for annotation spans. */
export const STYLE_ELEMENT_ID = 'wordlens-annotation-style';

export const MAX_TERM_LENGTH = 100;
