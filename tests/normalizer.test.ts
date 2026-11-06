import { describe, expect, it } from 'vitest';
import { cleanTerm, normalizeTerm } from '../src/core/normalizer';
import { validateTerm, validateTranslation } from '../src/core/validation';

describe('normalizeTerm', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeTerm('  Speculative   Decoding ')).toBe('speculative decoding');
    expect(normalizeTerm('INFERENCE')).toBe('inference');
  });

  it('keeps inner punctuation that belongs to a term', () => {
    expect(normalizeTerm('State-of-the-Art')).toBe('state-of-the-art');
    expect(normalizeTerm('Qwen3.5')).toBe('qwen3.5');
  });
});

describe('cleanTerm', () => {
  it('strips surrounding punctuation', () => {
    expect(cleanTerm('art,')).toBe('art');
    expect(cleanTerm('(art)')).toBe('art');
    expect(cleanTerm('“art.”')).toBe('art');
    expect(cleanTerm('  art:  ')).toBe('art');
  });

  it('keeps punctuation inside a term', () => {
    expect(cleanTerm('speculative decoding.')).toBe('speculative decoding');
    expect(cleanTerm('state-of-the-art,')).toBe('state-of-the-art');
    expect(cleanTerm('Qwen3.5')).toBe('Qwen3.5');
    expect(cleanTerm('C++')).toBe('C++');
  });
});

describe('validateTerm', () => {
  it('accepts words, phrases, hyphenated and numbered terms', () => {
    expect(validateTerm('speculative decoding')).toEqual({ ok: true, term: 'speculative decoding' });
    expect(validateTerm('state-of-the-art')).toEqual({ ok: true, term: 'state-of-the-art' });
    expect(validateTerm('Qwen3.5')).toEqual({ ok: true, term: 'Qwen3.5' });
    expect(validateTerm('(art),')).toEqual({ ok: true, term: 'art' });
  });

  it('rejects empty, Chinese-only, numeric-only and overly long selections', () => {
    expect(validateTerm('   ').ok).toBe(false);
    expect(validateTerm('中文').ok).toBe(false);
    expect(validateTerm('12345').ok).toBe(false);
    expect(validateTerm('a'.repeat(101)).ok).toBe(false);
    expect(validateTerm('这是 a 句子').ok).toBe(false);
  });
});

describe('validateTranslation', () => {
  it('requires a non-empty meaning and normalises spacing', () => {
    expect(validateTranslation('')).toEqual({ ok: false, error: 'Chinese meaning is required.' });
    expect(validateTranslation('   ').ok).toBe(false);
    expect(validateTranslation('  投机   解码 ')).toEqual({ ok: true, translation: '投机 解码' });
  });
});
