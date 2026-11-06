import { beforeEach, describe, expect, it } from 'vitest';
import { RegexDictionaryMatcher } from '../src/core/dictionary-matcher';
import type { DictionaryEntry } from '../src/core/types';

function entry(term: string, translation: string): DictionaryEntry {
  return {
    id: term,
    term,
    translation,
    normalizedTerm: term.toLowerCase().replace(/\s+/g, ' ').trim(),
    createdAt: 0,
    updatedAt: 0,
  };
}

const matcher = new RegexDictionaryMatcher();

beforeEach(() => {
  matcher.setDictionary([]);
});

describe('single word matching', () => {
  beforeEach(() => {
    matcher.setDictionary([entry('art', '艺术')]);
  });

  it('matches the bare word', () => {
    expect(matcher.match('art')).toHaveLength(1);
    expect(matcher.match('art')).toEqual([{ start: 0, end: 3, term: 'art', translation: '艺术' }]);
  });

  it('matches the word next to punctuation', () => {
    for (const text of ['art,', 'art.', 'art:', '(art)', '“art”', 'art\n']) {
      expect(matcher.match(text), text).toHaveLength(1);
    }
  });

  it('does not match inside longer words', () => {
    for (const text of ['partial', 'article', 'party', 'art-house', 'arts', 'art2', '_art']) {
      expect(matcher.match(text), text).toHaveLength(0);
    }
  });

  it('is case-insensitive', () => {
    for (const text of ['Art', 'ART', 'aRt']) {
      expect(matcher.match(text), text).toHaveLength(1);
    }
  });

  it('reports UTF-16 indices that slice the original text', () => {
    const text = 'pre art post';
    const [hit] = matcher.match(text);
    expect(hit).toBeDefined();
    expect(text.slice(hit!.start, hit!.end)).toBe('art');
  });
});

describe('phrase matching', () => {
  beforeEach(() => {
    matcher.setDictionary([
      entry('model', '模型'),
      entry('language model', '语言模型'),
      entry('large language model', '大语言模型'),
    ]);
  });

  it('prefers the longest match and never overlaps', () => {
    const hits = matcher.match('large language model');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.term).toBe('large language model');
  });

  it('falls back to the shorter phrase when the longer one is absent', () => {
    const hits = matcher.match('this language model is small');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.term).toBe('language model');
  });

  it('annotates multiple separate terms once each', () => {
    const text = 'The model uses speculative decoding and quantisation.';
    const second = new RegexDictionaryMatcher();
    second.setDictionary([entry('model', '模型'), entry('speculative decoding', '投机解码')]);
    const hits = second.match(text);
    expect(hits.map((hit) => hit.term)).toEqual(['model', 'speculative decoding']);
    expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe('model');
    expect(text.slice(hits[1]!.start, hits[1]!.end)).toBe('speculative decoding');
  });

  it('tolerates irregular whitespace between the words', () => {
    expect(matcher.match('large   language\nmodel')).toHaveLength(1);
  });

  it('still respects word boundaries around the phrase', () => {
    expect(matcher.match('modelling art')).toHaveLength(0);
  });
});

describe('whole sentence from the spec', () => {
  it('annotates each term exactly once', () => {
    matcher.setDictionary([
      entry('speculative decoding', '投机解码'),
      entry('inference', '推理'),
      entry('quantization', '量化'),
    ]);
    const text =
      'The model uses speculative decoding to improve inference throughput through quantization.';
    const hits = matcher.match(text);
    expect(hits.map((hit) => text.slice(hit.start, hit.end))).toEqual([
      'speculative decoding',
      'inference',
      'quantization',
    ]);
  });
});

describe('edge cases', () => {
  it('returns nothing for an empty dictionary', () => {
    expect(matcher.match('anything at all')).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    matcher.setDictionary([entry('art', '艺术')]);
    expect(matcher.match('')).toEqual([]);
  });

  it('handles regex metacharacters in terms', () => {
    matcher.setDictionary([entry('c++', 'C++ 语言'), entry('node.js', 'Node 运行时')]);
    expect(matcher.match('I like C++ and Node.js')).toHaveLength(2);
    expect(matcher.match('C+++')).toHaveLength(1);
    expect(matcher.match('xc++')).toHaveLength(0);
  });

  it('handles Chinese translations with punctuation', () => {
    matcher.setDictionary([entry('attention mechanism', '注意力机制（Attention）')]);
    const [hit] = matcher.match('the attention mechanism works');
    expect(hit?.translation).toBe('注意力机制（Attention）');
  });
});
