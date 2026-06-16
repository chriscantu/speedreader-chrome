import { describe, it, expect } from 'vitest';
import { validatePositionSet, validatePositionDelete } from '../validate';

describe('validatePositionSet — wire shape gate', () => {
  it('accepts a well-formed payload', () => {
    expect(validatePositionSet({ wordIndex: 10, totalWords: 100 })).toEqual({
      wordIndex: 10,
      totalWords: 100,
    });
  });

  it('ignores extra keys, returning only the typed fields', () => {
    expect(validatePositionSet({ wordIndex: 1, totalWords: 2, url: 'evil', extra: true })).toEqual({
      wordIndex: 1,
      totalWords: 2,
    });
  });

  it.each([
    ['non-object', 'nope'],
    ['null', null],
    ['missing wordIndex', { totalWords: 5 }],
    ['missing totalWords', { wordIndex: 5 }],
    ['string wordIndex', { wordIndex: '5', totalWords: 5 }],
    ['NaN wordIndex', { wordIndex: NaN, totalWords: 5 }],
    ['Infinity totalWords', { wordIndex: 1, totalWords: Infinity }],
  ])('rejects %s', (_label, raw) => {
    expect(validatePositionSet(raw)).toBeNull();
  });
});

describe('validatePositionDelete — wire shape gate', () => {
  it('accepts a non-empty url string', () => {
    expect(validatePositionDelete({ url: 'https://example.com/a' })).toEqual({
      url: 'https://example.com/a',
    });
  });

  it.each([
    ['non-object', 42],
    ['null', null],
    ['missing url', {}],
    ['empty url', { url: '' }],
    ['non-string url', { url: 123 }],
  ])('rejects %s', (_label, raw) => {
    expect(validatePositionDelete(raw)).toBeNull();
  });
});
