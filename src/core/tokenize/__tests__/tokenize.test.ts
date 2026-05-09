import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenize';

describe('tokenize', () => {
  describe('empty / whitespace', () => {
    it('returns [] for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('returns [] for whitespace-only string', () => {
      expect(tokenize('   \t\n  ')).toEqual([]);
    });
  });

  describe('basic splitting', () => {
    it('returns single token for one word', () => {
      expect(tokenize('word')).toEqual(['word']);
    });

    it('splits multi-word input on single spaces', () => {
      expect(tokenize('the quick brown fox')).toEqual(['the', 'quick', 'brown', 'fox']);
    });

    it('collapses runs of whitespace', () => {
      expect(tokenize('a  \t  b\t\tc')).toEqual(['a', 'b', 'c']);
    });

    it('treats single newlines as soft wraps (collapsed as whitespace)', () => {
      expect(tokenize('hello\nworld\nfoo')).toEqual(['hello', 'world', 'foo']);
    });

    it('trims leading and trailing whitespace', () => {
      expect(tokenize('   hello world   ')).toEqual(['hello', 'world']);
    });
  });

  describe('punctuation attached to preceding word', () => {
    it('keeps comma and period attached', () => {
      expect(tokenize('Hello, world.')).toEqual(['Hello,', 'world.']);
    });

    it('keeps semicolon, colon, exclamation, question attached', () => {
      expect(tokenize('one; two: three! four?')).toEqual(['one;', 'two:', 'three!', 'four?']);
    });

    it('keeps combined punctuation attached', () => {
      expect(tokenize('Really?! Yes.')).toEqual(['Really?!', 'Yes.']);
    });
  });

  describe('contractions', () => {
    it('preserves straight-apostrophe contractions', () => {
      expect(tokenize("don't they're we'd I'll")).toEqual(["don't", "they're", "we'd", "I'll"]);
    });

    it('preserves curly-apostrophe contractions', () => {
      expect(tokenize('don’t it’s')).toEqual(['don’t', 'it’s']);
    });
  });

  describe('hyphenated words', () => {
    it('treats two-part hyphenated word as one token', () => {
      expect(tokenize('well-known')).toEqual(['well-known']);
    });

    it('treats multi-part hyphenated word as one token', () => {
      expect(tokenize('state-of-the-art co-op')).toEqual(['state-of-the-art', 'co-op']);
    });

    it('handles leading and trailing hyphen edge cases', () => {
      expect(tokenize('-foo bar-')).toEqual(['-foo', 'bar-']);
    });
  });

  describe('em-dash', () => {
    it('splits em-dash with surrounding spaces into its own token', () => {
      expect(tokenize('He said — run!')).toEqual(['He', 'said', '—', 'run!']);
    });

    it('splits em-dash without surrounding spaces into its own token', () => {
      expect(tokenize('He said—run!')).toEqual(['He', 'said', '—', 'run!']);
    });

    it('handles multiple em-dashes', () => {
      expect(tokenize('a—b—c')).toEqual(['a', '—', 'b', '—', 'c']);
    });
  });

  describe('en-dash', () => {
    it('splits en-dash with surrounding spaces into its own token', () => {
      expect(tokenize('pages 12 – 15')).toEqual(['pages', '12', '–', '15']);
    });

    it('splits en-dash without surrounding spaces into its own token', () => {
      expect(tokenize('pages 12–15')).toEqual(['pages', '12', '–', '15']);
    });

    // Date ranges split, mirroring em-dash. Every dash is a pause marker —
    // beats keeping `2024–2026` whole.
    it('splits date-range en-dash into its own token', () => {
      expect(tokenize('2024–2026 era')).toEqual(['2024', '–', '2026', 'era']);
    });
  });

  describe('paragraph-sentinel placeholder collision (regression)', () => {
    it('preserves bareword "PB" as a token at edges', () => {
      expect(tokenize('PB')).toEqual(['PB']);
    });

    it('preserves bareword "PB" mid-sentence', () => {
      expect(tokenize('PB and J')).toEqual(['PB', 'and', 'J']);
    });

    it('preserves bareword "PB" alongside paragraph break', () => {
      expect(tokenize('hello\n\nPB sandwich')).toEqual(['hello', '\n\n', 'PB', 'sandwich']);
    });

    it('preserves multiple bareword "PB" occurrences', () => {
      expect(tokenize('foo PB bar PB baz')).toEqual(['foo', 'PB', 'bar', 'PB', 'baz']);
    });
  });

  describe('em-dash adjacent to paragraph break', () => {
    it('preserves em-dash and paragraph break as distinct ordered tokens', () => {
      expect(tokenize('a—\n\nb')).toEqual(['a', '—', '\n\n', 'b']);
    });
  });

  describe('paragraph break sentinel', () => {
    it('emits "\\n\\n" between two paragraphs', () => {
      expect(tokenize('hello world\n\nfoo bar')).toEqual(['hello', 'world', '\n\n', 'foo', 'bar']);
    });

    it('collapses runs of 4 newlines to a single paragraph sentinel', () => {
      expect(tokenize('hello\n\n\n\nworld')).toEqual(['hello', '\n\n', 'world']);
    });

    it('emits one sentinel between each adjacent paragraph pair', () => {
      expect(tokenize('a\n\nb\n\nc')).toEqual(['a', '\n\n', 'b', '\n\n', 'c']);
    });

    it('strips leading paragraph break', () => {
      expect(tokenize('\n\nfoo bar')).toEqual(['foo', 'bar']);
    });

    it('strips trailing paragraph break', () => {
      expect(tokenize('foo bar\n\n')).toEqual(['foo', 'bar']);
    });
  });

  describe('ellipsis', () => {
    it('keeps three-dot ellipsis attached to preceding word', () => {
      expect(tokenize('Wait... what?')).toEqual(['Wait...', 'what?']);
    });

    it('keeps single-char ellipsis attached to preceding word', () => {
      expect(tokenize('Wait… what?')).toEqual(['Wait…', 'what?']);
    });
  });

  describe('smart quotes', () => {
    it('preserves curly quotes attached to the word', () => {
      expect(tokenize('“Hello,” he said.')).toEqual(['“Hello,”', 'he', 'said.']);
    });
  });

  describe('numbers, currency, decimals', () => {
    it('keeps integer as single token', () => {
      expect(tokenize('year 2026')).toEqual(['year', '2026']);
    });

    it('keeps decimal as single token', () => {
      expect(tokenize('pi is 3.14')).toEqual(['pi', 'is', '3.14']);
    });

    it('keeps currency as single token', () => {
      expect(tokenize('costs $5.99 today')).toEqual(['costs', '$5.99', 'today']);
    });

    it('keeps comma-separated thousands as single token', () => {
      expect(tokenize('1,000 dollars')).toEqual(['1,000', 'dollars']);
    });
  });

  describe('URLs and emails', () => {
    it('keeps full https URL as a single token', () => {
      expect(tokenize('see https://example.com/foo here')).toEqual([
        'see',
        'https://example.com/foo',
        'here',
      ]);
    });

    it('keeps email as a single token', () => {
      expect(tokenize('mail user@example.com now')).toEqual(['mail', 'user@example.com', 'now']);
    });
  });

  describe('unicode pass-through', () => {
    it('preserves Latin-1 supplement characters', () => {
      expect(tokenize('café résumé naïve')).toEqual(['café', 'résumé', 'naïve']);
    });

    it('preserves CJK as written (no segmentation)', () => {
      expect(tokenize('中文 한글')).toEqual(['中文', '한글']);
    });

    it('preserves emoji including surrogate-pair characters', () => {
      expect(tokenize('hi \u{1F600} world')).toEqual(['hi', '\u{1F600}', 'world']);
    });
  });

  describe('invisible character stripping', () => {
    it('strips zero-width space, ZWNJ, ZWJ, BOM before splitting', () => {
      expect(tokenize('foo​‌‍﻿bar baz')).toEqual(['foobar', 'baz']);
    });

    it('strips soft hyphen before splitting', () => {
      expect(tokenize('docu­ment')).toEqual(['document']);
    });
  });
});
