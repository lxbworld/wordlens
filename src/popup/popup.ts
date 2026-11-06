import { ChromeDictionaryRepository } from '../core/dictionary-repository';
import type { DictionaryEntry } from '../core/types';
import { validateTranslation } from '../core/validation';

const repository = new ChromeDictionaryRepository();

const listEl = requireElement<HTMLUListElement>('#list');
const countEl = requireElement<HTMLSpanElement>('#count');
const searchEl = requireElement<HTMLInputElement>('#search');
const emptyEl = requireElement<HTMLParagraphElement>('#empty');
const statusEl = requireElement<HTMLParagraphElement>('#status');

let entries: DictionaryEntry[] = [];
let query = '';
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function setStatus(message: string): void {
  statusEl.textContent = message;
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 4000);
}

function matchesQuery(entry: DictionaryEntry): boolean {
  if (!query) return true;
  return (
    entry.normalizedTerm.includes(query) || entry.translation.toLowerCase().includes(query)
  );
}

function renderRow(entry: DictionaryEntry): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'row';
  row.dataset.id = entry.id;

  const term = document.createElement('span');
  term.className = 'term';
  term.textContent = entry.term;
  term.title = entry.term;

  const translation = document.createElement('input');
  translation.className = 'translation';
  translation.value = entry.translation;
  translation.setAttribute('aria-label', `Chinese meaning for ${entry.term}`);
  translation.addEventListener('change', () => {
    const check = validateTranslation(translation.value);
    if (!check.ok) {
      translation.value = entry.translation;
      setStatus(check.error);
      return;
    }
    if (check.translation === entry.translation) return;
    repository.update(entry.id, check.translation).then(
      () => setStatus(`Updated "${entry.term}".`),
      (error: unknown) => {
        translation.value = entry.translation;
        setStatus(error instanceof Error ? error.message : 'Could not save.');
      },
    );
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete';
  remove.textContent = '✕';
  remove.title = 'Delete';
  remove.setAttribute('aria-label', `Delete ${entry.term}`);
  remove.addEventListener('click', () => {
    repository.delete(entry.id).then(
      () => setStatus(`Deleted "${entry.term}".`),
      () => setStatus('Could not delete.'),
    );
  });

  row.append(term, translation, remove);
  return row;
}

function render(): void {
  const visible = entries.filter(matchesQuery);
  listEl.replaceChildren(...visible.map(renderRow));
  countEl.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  const nothingStored = entries.length === 0;
  emptyEl.hidden = !(nothingStored || visible.length === 0);
  emptyEl.textContent = nothingStored
    ? 'No entries yet. Select English text on any page, then click “+ 添加到 WordLens”.'
    : 'No match.';
}

async function load(): Promise<void> {
  entries = await repository.getAll();
  render();
}

searchEl.addEventListener('input', () => {
  query = searchEl.value.trim().toLowerCase();
  render();
});

// Edits and deletions made in another tab (or on a page) show up immediately.
repository.subscribe((next) => {
  entries = next;
  render();
});

void load().catch(() => setStatus('Could not read the dictionary.'));
