import { describe, expect, it } from 'vitest';
import {
  ChromeDictionaryRepository,
  DuplicateEntryError,
  DictionaryStorageError,
  sanitizeEntries,
  type StorageChangeLike,
  type StorageChangeSource,
  type StorageAreaLike,
} from '../src/core/dictionary-repository';
import { STORAGE_KEY } from '../src/shared/constants';

class MemoryStorage implements StorageAreaLike {
  data: Record<string, unknown> = {};
  failNextWrite = false;

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.data ? { [key]: this.data[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('QUOTA_BYTES quota exceeded');
    }
    Object.assign(this.data, items);
  }
}

class FakeChanges implements StorageChangeSource {
  listeners = new Set<(changes: StorageChangeLike, areaName: string) => void>();

  addListener(listener: (changes: StorageChangeLike, areaName: string) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (changes: StorageChangeLike, areaName: string) => void): void {
    this.listeners.delete(listener);
  }

  emit(changes: StorageChangeLike, areaName = 'local'): void {
    for (const listener of this.listeners) listener(changes, areaName);
  }
}

function setup() {
  const storage = new MemoryStorage();
  const changes = new FakeChanges();
  const repository = new ChromeDictionaryRepository({ storage, changes });
  return { storage, changes, repository };
}

describe('DictionaryRepository', () => {
  it('starts empty', async () => {
    const { repository } = setup();
    expect(await repository.getAll()).toEqual([]);
  });

  it('adds an entry with a normalised key and timestamps', async () => {
    const { repository, storage } = setup();
    await repository.add({ term: '  Speculative   Decoding ', translation: ' 投机解码 ' });

    const stored = storage.data[STORAGE_KEY] as { version: number; entries: unknown[] };
    expect(stored.version).toBe(1);
    expect(stored.entries).toHaveLength(1);

    const [entry] = await repository.getAll();
    expect(entry?.term).toBe('Speculative Decoding');
    expect(entry?.translation).toBe('投机解码');
    expect(entry?.normalizedTerm).toBe('speculative decoding');
    expect(entry?.createdAt).toBeGreaterThan(0);
  });

  it('finds entries case-insensitively and ignores value-less input', async () => {
    const { repository } = setup();
    await repository.add({ term: 'Inference', translation: '推理' });
    expect((await repository.findByTerm('  inference '))?.translation).toBe('推理');
    expect(await repository.findByTerm('')).toBeNull();
    expect(await repository.findByTerm('quantization')).toBeNull();
  });

  it('refuses duplicate terms instead of storing two rows', async () => {
    const { repository } = setup();
    await repository.add({ term: 'inference', translation: '推理' });
    await expect(repository.add({ term: 'INFERENCE', translation: '推断' })).rejects.toBeInstanceOf(
      DuplicateEntryError,
    );
    expect(await repository.getAll()).toHaveLength(1);
  });

  it('updates the translation in place', async () => {
    const { repository } = setup();
    const created = await repository.add({ term: 'inference', translation: '推理' });
    await repository.update(created.id, '推断');

    const [entry] = await repository.getAll();
    expect(entry?.translation).toBe('推断');
    expect(entry?.createdAt).toBe(created.createdAt);
    expect(entry?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('rejects an empty translation and unknown ids', async () => {
    const { repository } = setup();
    const created = await repository.add({ term: 'inference', translation: '推理' });
    await expect(repository.update(created.id, '   ')).rejects.toThrow('Chinese meaning is required.');
    await expect(repository.update('missing', '推理')).rejects.toThrow();
  });

  it('deletes entries', async () => {
    const { repository } = setup();
    const first = await repository.add({ term: 'inference', translation: '推理' });
    const second = await repository.add({ term: 'quantization', translation: '量化' });
    await repository.delete(first.id);
    expect((await repository.getAll()).map((entry) => entry.id)).toEqual([second.id]);
    await repository.delete('does-not-exist');
    expect(await repository.getAll()).toHaveLength(1);
  });

  it('validates terms before writing', async () => {
    const { repository } = setup();
    await expect(repository.add({ term: '中文', translation: '中文' })).rejects.toThrow();
    await expect(repository.add({ term: 'art', translation: '' })).rejects.toThrow();
  });

  it('notifies subscribers on storage changes and unsubscribes cleanly', async () => {
    const { repository, changes, storage } = setup();
    const seen: number[] = [];
    const unsubscribe = repository.subscribe((entries) => seen.push(entries.length));

    await repository.add({ term: 'inference', translation: '推理' });
    const payload = storage.data[STORAGE_KEY];
    changes.emit({ [STORAGE_KEY]: { newValue: payload } });
    expect(seen).toEqual([1]);

    // Unrelated keys and other storage areas are ignored.
    changes.emit({ somethingElse: { newValue: 1 } });
    changes.emit({ [STORAGE_KEY]: { newValue: payload } }, 'sync');
    expect(seen).toEqual([1]);

    unsubscribe();
    changes.emit({ [STORAGE_KEY]: { newValue: payload } });
    expect(seen).toEqual([1]);
  });

  it('surfaces storage failures instead of pretending to save', async () => {
    const { repository, storage } = setup();
    storage.failNextWrite = true;
    await expect(repository.add({ term: 'art', translation: '艺术' })).rejects.toBeInstanceOf(
      DictionaryStorageError,
    );
    expect(await repository.getAll()).toEqual([]);
  });

  it('keeps working when stored data is corrupt', async () => {
    const { repository, storage } = setup();
    storage.data[STORAGE_KEY] = {
      version: 1,
      entries: [
        null,
        'nope',
        { term: 'art', translation: '艺术' },
        { term: 'ART', translation: '艺术（重复）' },
        { term: 'inference' },
        { term: 'model', translation: '  模型 ' },
      ],
    };
    const entries = await repository.getAll();
    expect(entries.map((entry) => entry.term)).toEqual(['art', 'model']);
    expect(entries[0]?.id).toBeTruthy();
    expect(entries[0]?.normalizedTerm).toBe('art');
  });
});

describe('sanitizeEntries', () => {
  it('returns an empty list for anything that is not a dictionary document', () => {
    expect(sanitizeEntries(undefined)).toEqual([]);
    expect(sanitizeEntries(null)).toEqual([]);
    expect(sanitizeEntries({ version: 1 })).toEqual([]);
    expect(sanitizeEntries({ entries: 'nope' })).toEqual([]);
  });

  it('repairs a missing normalised term', () => {
    const [entry] = sanitizeEntries({ entries: [{ term: 'Large  Model', translation: '大模型' }] });
    expect(entry?.normalizedTerm).toBe('large model');
    expect(entry?.term).toBe('Large Model');
  });
});
