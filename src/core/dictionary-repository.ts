import { DICTIONARY_VERSION, STORAGE_KEY } from '../shared/constants';
import { cleanTerm, normalizeTerm } from './normalizer';
import type { CreateDictionaryEntry, DictionaryEntry } from './types';
import { validateTerm, validateTranslation } from './validation';

/** The slice of chrome.storage that the repository needs (cheap to fake in tests). */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type StorageChangeLike = Record<string, { oldValue?: unknown; newValue?: unknown }>;

export interface StorageChangeSource {
  addListener(listener: (changes: StorageChangeLike, areaName: string) => void): void;
  removeListener(listener: (changes: StorageChangeLike, areaName: string) => void): void;
}

export class DuplicateEntryError extends Error {
  constructor(term: string) {
    super(`"${term}" is already in the dictionary.`);
    this.name = 'DuplicateEntryError';
  }
}

export class DictionaryStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DictionaryStorageError';
  }
}

export function createEntryId(): string {
  // crypto.randomUUID is missing on plain-http pages, hence the fallback.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Never trust what is in storage: drop unusable rows, fill in missing bookkeeping fields. */
export function sanitizeEntries(raw: unknown): DictionaryEntry[] {
  const entries = (raw as { entries?: unknown } | null | undefined)?.entries;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const out: DictionaryEntry[] = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<DictionaryEntry>;
    if (typeof candidate.term !== 'string' || typeof candidate.translation !== 'string') continue;

    const term = cleanTerm(candidate.term);
    const translation = candidate.translation.trim();
    if (!term || !translation) continue;

    const normalizedTerm =
      typeof candidate.normalizedTerm === 'string' && candidate.normalizedTerm
        ? normalizeTerm(candidate.normalizedTerm)
        : normalizeTerm(term);
    if (seen.has(normalizedTerm)) continue;
    seen.add(normalizedTerm);

    const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now();
    out.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createEntryId(),
      term,
      translation,
      normalizedTerm,
      createdAt,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : createdAt,
    });
  }
  return out;
}

export interface DictionaryRepository {
  getAll(): Promise<DictionaryEntry[]>;
  findByTerm(term: string): Promise<DictionaryEntry | null>;
  add(entry: CreateDictionaryEntry): Promise<DictionaryEntry>;
  update(id: string, translation: string): Promise<void>;
  delete(id: string): Promise<void>;
  subscribe(callback: (entries: DictionaryEntry[]) => void): () => void;
}

export interface RepositoryOptions {
  storage?: StorageAreaLike;
  changes?: StorageChangeSource;
}

function chromeStorage(): StorageAreaLike {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
  };
}

function chromeChanges(): StorageChangeSource {
  return {
    addListener: (listener) => chrome.storage.onChanged.addListener(listener),
    removeListener: (listener) => chrome.storage.onChanged.removeListener(listener),
  };
}

export class ChromeDictionaryRepository implements DictionaryRepository {
  private readonly storage: StorageAreaLike;
  private readonly changes: StorageChangeSource;

  constructor(options: RepositoryOptions = {}) {
    this.storage = options.storage ?? chromeStorage();
    this.changes = options.changes ?? chromeChanges();
  }

  async getAll(): Promise<DictionaryEntry[]> {
    return this.read();
  }

  async findByTerm(term: string): Promise<DictionaryEntry | null> {
    const key = normalizeTerm(cleanTerm(term));
    if (!key) return null;
    const entries = await this.read();
    return entries.find((entry) => entry.normalizedTerm === key) ?? null;
  }

  async add(entry: CreateDictionaryEntry): Promise<DictionaryEntry> {
    const termCheck = validateTerm(entry.term);
    if (!termCheck.ok) throw new Error(termCheck.error);
    const translationCheck = validateTranslation(entry.translation);
    if (!translationCheck.ok) throw new Error(translationCheck.error);

    const normalizedTerm = normalizeTerm(termCheck.term);
    const entries = await this.read();
    if (entries.some((existing) => existing.normalizedTerm === normalizedTerm)) {
      throw new DuplicateEntryError(termCheck.term);
    }

    const now = Date.now();
    const created: DictionaryEntry = {
      id: createEntryId(),
      term: termCheck.term,
      translation: translationCheck.translation,
      normalizedTerm,
      createdAt: now,
      updatedAt: now,
    };
    await this.write([...entries, created]);
    return created;
  }

  async update(id: string, translation: string): Promise<void> {
    const check = validateTranslation(translation);
    if (!check.ok) throw new Error(check.error);

    const entries = await this.read();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) throw new Error('That entry no longer exists.');

    const current = entries[index];
    if (!current) throw new Error('That entry no longer exists.');
    const next = [...entries];
    next[index] = { ...current, translation: check.translation, updatedAt: Date.now() };
    await this.write(next);
  }

  async delete(id: string): Promise<void> {
    const entries = await this.read();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return;
    await this.write(next);
  }

  subscribe(callback: (entries: DictionaryEntry[]) => void): () => void {
    const listener = (changes: StorageChangeLike, areaName: string) => {
      if (areaName && areaName !== 'local') return;
      const change = changes[STORAGE_KEY];
      if (!change) return;
      callback(sanitizeEntries(change.newValue));
    };
    this.changes.addListener(listener);
    return () => this.changes.removeListener(listener);
  }

  private async read(): Promise<DictionaryEntry[]> {
    try {
      const stored = await this.storage.get(STORAGE_KEY);
      return sanitizeEntries(stored[STORAGE_KEY]);
    } catch (error) {
      throw new DictionaryStorageError('Could not read the dictionary.', error);
    }
  }

  private async write(entries: DictionaryEntry[]): Promise<void> {
    try {
      await this.storage.set({
        [STORAGE_KEY]: { version: DICTIONARY_VERSION, entries },
      });
    } catch (error) {
      throw new DictionaryStorageError('Could not save the dictionary.', error);
    }
  }
}
