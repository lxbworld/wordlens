import annotationCss from '../styles/annotation.css?inline';
import type { DictionaryEntry } from '../core/types';
import { ChromeDictionaryRepository } from '../core/dictionary-repository';
import { RegexDictionaryMatcher } from '../core/dictionary-matcher';
import { AnnotationEngine } from './annotation-engine';
import { injectAnnotationStyles } from './annotation-renderer';
import { SelectionManager } from './selection-listener';
import { SelectionToolbar } from './selection-toolbar';

const REFRESH_DEBOUNCE_MS = 120;

function debounce(run: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, ms);
  };
}

async function main(): Promise<void> {
  const repository = new ChromeDictionaryRepository();
  const matcher = new RegexDictionaryMatcher();
  const engine = new AnnotationEngine(document, matcher);
  const toolbar = new SelectionToolbar(document);

  injectAnnotationStyles(document, annotationCss);
  document.documentElement.appendChild(toolbar.host);

  matcher.setDictionary(await repository.getAll().catch(() => []));
  engine.start();

  let pending: DictionaryEntry[] | null = null;
  const flushPending = debounce(() => {
    if (!pending) return;
    matcher.setDictionary(pending);
    pending = null;
    engine.refresh();
  }, REFRESH_DEBOUNCE_MS);

  repository.subscribe((entries) => {
    pending = entries;
    flushPending();
  });

  toolbar.onOpen = async (term) => (await repository.findByTerm(term))?.translation ?? null;
  toolbar.onSave = async (term, translation) => {
    const existing = await repository.findByTerm(term);
    if (existing) await repository.update(existing.id, translation);
    else await repository.add({ term, translation });
    // Don't depend on the storage event alone: annotate right away.
    matcher.setDictionary(await repository.getAll());
    engine.refresh();
  };

  const selection = new SelectionManager(
    document,
    {
      onSelect: ({ term, rect }) => toolbar.showToolbar(term, rect),
      onClear: () => toolbar.hideToolbar(),
    },
    (target) => toolbar.isUiTarget(target),
  );
  selection.start();
}

if (document.body) {
  void main().catch((error) => console.error('[WordLens] failed to start', error));
}
