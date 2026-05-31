import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenize';
import { markSentenceBoundaries } from '../sentence-boundary';
import type { MarkedToken } from '../sentence-boundary';

// Cases mirror `docs/superpowers/specs/2026-05-14-sentence-boundary.md`:
//   - Cases 1-6, 8: Safari parity (`chriscantu/speed-reader/tests/js/word-processor.test.js`)
//   - Case 7: Chrome deliberately diverges from Safari (honorific exemption)
//   - Cases 9-21: Chrome-side additions pinned by the spec
//
// Each case reads the spec's §"Test cases" table for expected `sentenceStart`
// and `sentenceEnd` arrays on the word tokens.

function wordTokens(marks: MarkedToken[]): Array<Extract<MarkedToken, { kind: 'word' }>> {
  return marks.filter((m): m is Extract<MarkedToken, { kind: 'word' }> => m.kind === 'word');
}

function starts(marks: MarkedToken[]): boolean[] {
  return wordTokens(marks).map((m) => m.sentenceStart);
}

function ends(marks: MarkedToken[]): boolean[] {
  return wordTokens(marks).map((m) => m.sentenceEnd);
}

describe('markSentenceBoundaries — Safari parity cases', () => {
  it('case 1: bare periods between sentences', () => {
    const marks = markSentenceBoundaries(tokenize('First sentence. Second sentence.'));
    expect(starts(marks)).toEqual([true, false, true, false]);
    expect(ends(marks)).toEqual([false, true, false, true]);
  });

  it('case 2: question mark mid-stream', () => {
    const marks = markSentenceBoundaries(tokenize('Is this right? Yes it is.'));
    expect(starts(marks)).toEqual([true, false, false, true, false, false]);
    expect(ends(marks)).toEqual([false, false, true, false, false, true]);
  });

  it('case 3: exclamation mark', () => {
    const marks = markSentenceBoundaries(tokenize('Wow! That is great.'));
    expect(starts(marks)).toEqual([true, true, false, false]);
    expect(ends(marks)).toEqual([true, false, false, true]);
  });

  it('case 4: period followed by stacked brackets', () => {
    const marks = markSentenceBoundaries(
      tokenize('increase retention.[10][11][2] There are three types'),
    );
    expect(starts(marks)).toEqual([true, false, true, false, false, false]);
    expect(ends(marks)).toEqual([false, true, false, false, false, false]);
  });

  it('case 5: period followed by closing paren', () => {
    const marks = markSentenceBoundaries(tokenize('(see footnote.) The next'));
    expect(starts(marks)).toEqual([true, false, true, false]);
    expect(ends(marks)).toEqual([false, true, false, false]);
  });

  it('case 6: period followed by closing quote', () => {
    const marks = markSentenceBoundaries(tokenize('she said." He left.'));
    expect(starts(marks)).toEqual([true, false, true, false]);
    expect(ends(marks)).toEqual([false, true, false, true]);
  });

  it('case 7: honorific+bracket Dr.[Smith] (Chrome diverges from Safari)', () => {
    // Safari would emit [true, true]; Chrome exempts the honorific → [true, false].
    const marks = markSentenceBoundaries(tokenize('Dr.[Smith] gave'));
    expect(starts(marks)).toEqual([true, false]);
    expect(ends(marks)).toEqual([false, false]);
  });

  it('case 8: bare brackets without preceding punctuation do NOT end a sentence', () => {
    const marks = markSentenceBoundaries(tokenize('see [10] for details'));
    expect(starts(marks)).toEqual([true, false, false, false]);
    expect(ends(marks)).toEqual([false, false, false, false]);
  });
});

describe('markSentenceBoundaries — Chrome-side cases', () => {
  it('case 9: empty input returns empty output', () => {
    expect(markSentenceBoundaries(tokenize(''))).toEqual([]);
  });

  it('case 10: single word', () => {
    const marks = markSentenceBoundaries(tokenize('one'));
    expect(marks).toEqual([
      { kind: 'word', text: 'one', sentenceStart: true, sentenceEnd: false, rawIndex: 0 },
    ]);
  });

  it('case 11: paragraph break ends a sentence even without .!?', () => {
    const marks = markSentenceBoundaries(tokenize('hello\n\nworld'));
    expect(marks).toEqual([
      { kind: 'word', text: 'hello', sentenceStart: true, sentenceEnd: false, rawIndex: 0 },
      { kind: 'paragraph', text: '\n\n' },
      { kind: 'word', text: 'world', sentenceStart: true, sentenceEnd: false, rawIndex: 2 },
    ]);
  });

  it('case 12: em-dash does NOT end a sentence', () => {
    const marks = markSentenceBoundaries(tokenize('a — b'));
    expect(marks).toEqual([
      { kind: 'word', text: 'a', sentenceStart: true, sentenceEnd: false, rawIndex: 0 },
      { kind: 'dash', text: '—' },
      { kind: 'word', text: 'b', sentenceStart: false, sentenceEnd: false, rawIndex: 2 },
    ]);
  });

  it('case 13: sentence-end then paragraph break', () => {
    const marks = markSentenceBoundaries(tokenize('first.\n\nsecond.'));
    expect(marks).toEqual([
      { kind: 'word', text: 'first.', sentenceStart: true, sentenceEnd: true, rawIndex: 0 },
      { kind: 'paragraph', text: '\n\n' },
      { kind: 'word', text: 'second.', sentenceStart: true, sentenceEnd: true, rawIndex: 2 },
    ]);
  });

  it('case 14: mid-word period followed by comma does NOT end a sentence', () => {
    const marks = markSentenceBoundaries(tokenize('e.g., for example'));
    expect(starts(marks)).toEqual([true, false, false]);
    expect(ends(marks)).toEqual([false, false, false]);
  });

  it('case 15: em-dash before paragraph break (cutoff prose)', () => {
    const marks = markSentenceBoundaries(tokenize('a — \n\nb'));
    expect(marks).toEqual([
      { kind: 'word', text: 'a', sentenceStart: true, sentenceEnd: false, rawIndex: 0 },
      { kind: 'dash', text: '—' },
      { kind: 'paragraph', text: '\n\n' },
      { kind: 'word', text: 'b', sentenceStart: true, sentenceEnd: false, rawIndex: 3 },
    ]);
  });

  it('case 16: honorific exemption — Dr. is not a sentence end', () => {
    const marks = markSentenceBoundaries(tokenize('Dr. Smith arrived. He left.'));
    expect(starts(marks)).toEqual([true, false, false, true, false]);
    expect(ends(marks)).toEqual([false, false, true, false, true]);
  });

  it('case 17: ellipsis as sentence terminator', () => {
    const marks = markSentenceBoundaries(tokenize('Wait… what?'));
    expect(starts(marks)).toEqual([true, true]);
    expect(ends(marks)).toEqual([true, true]);
  });

  it('case 18: mixed trailing — bracket then quote (said.[note]")', () => {
    const marks = markSentenceBoundaries(tokenize('said.[note]" he wrote.'));
    expect(starts(marks)).toEqual([true, true, false]);
    expect(ends(marks)).toEqual([true, false, true]);
  });

  it('case 19: mixed trailing — quote then bracket (wow!"])', () => {
    const marks = markSentenceBoundaries(tokenize('wow!"] The end.'));
    expect(starts(marks)).toEqual([true, true, false]);
    expect(ends(marks)).toEqual([true, false, true]);
  });

  it('case 20: adjacent terminators (wow?!)', () => {
    const marks = markSentenceBoundaries(tokenize('wow?! Really.'));
    expect(starts(marks)).toEqual([true, true]);
    expect(ends(marks)).toEqual([true, true]);
  });

  it('case 21: CJK terminators', () => {
    const marks = markSentenceBoundaries(tokenize('中文。 한글？'));
    expect(starts(marks)).toEqual([true, true]);
    expect(ends(marks)).toEqual([true, true]);
  });
});

describe('markSentenceBoundaries — regression guards', () => {
  // Spec §"Looks like an abbreviation" enumerates 8 honorifics. Only case 16
  // exercises `Dr.`; this parametrized check catches both silent CONTRACTION
  // of the exemption set (someone refactors the regex to drop entries) and
  // silent EXPANSION (someone adds a new entry without spec coverage).
  it.each(['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'St.', 'Prof.', 'Sr.', 'Jr.'])(
    'honorific exemption: %s does not end a sentence',
    (honorific) => {
      const marks = markSentenceBoundaries(tokenize(`${honorific} Smith arrived.`));
      // The honorific token (index 0) must NOT have sentenceEnd: true.
      expect(ends(marks)[0]).toBe(false);
      // `Smith` (index 1) must NOT be flagged as starting a new sentence.
      expect(starts(marks)[1]).toBe(false);
    },
  );

  // Spec types `dash.text` as `'—' | '–'`. Only the em-dash is exercised
  // above; this case pins en-dash so a future refactor that drops EN_DASH
  // handling fails loudly.
  it('en-dash (–) is emitted as a dash sentinel and leaves state unchanged', () => {
    const marks = markSentenceBoundaries(tokenize('pages 12 – 15'));
    const dashes = marks.filter((m) => m.kind === 'dash');
    expect(dashes).toEqual([{ kind: 'dash', text: '–' }]);
    // Words around the en-dash: 'pages'(start:true), '12'(start:false),
    // '–'(dash), '15'(start:false). State carries through the dash.
    expect(starts(marks)).toEqual([true, false, false]);
    expect(ends(marks)).toEqual([false, false, false]);
  });

  // Spec §"What the regex does NOT match" lists `U.S.:` (colon) as a negative
  // case. Case 14 covers `e.g.,` (comma); this one pins the colon variant so
  // adding `:` to the closing-char set would fail loudly.
  it('mid-word period followed by colon does NOT end a sentence (U.S.:)', () => {
    const marks = markSentenceBoundaries(tokenize('visit the U.S.: it is nice.'));
    // tokens: ['visit', 'the', 'U.S.:', 'it', 'is', 'nice.']
    expect(ends(marks)).toEqual([false, false, false, false, false, true]);
    expect(starts(marks)).toEqual([true, false, false, false, false, false]);
  });
});

describe('markSentenceBoundaries — invariants', () => {
  it('preserves input length and order', () => {
    const tokens = tokenize('Hello world. Foo bar baz.');
    const marks = markSentenceBoundaries(tokens);
    expect(marks.length).toBe(tokens.length);
    marks.forEach((m, i) => {
      expect(m.text).toBe(tokens[i]);
    });
  });

  it('sentenceStart and sentenceEnd live only on word tokens', () => {
    const marks = markSentenceBoundaries(tokenize('a\n\nb — c.'));
    for (const m of marks) {
      if (m.kind === 'word') {
        expect(typeof m.sentenceStart).toBe('boolean');
        expect(typeof m.sentenceEnd).toBe('boolean');
      } else {
        expect(m).not.toHaveProperty('sentenceStart');
        expect(m).not.toHaveProperty('sentenceEnd');
      }
    }
  });

  // rawIndex is the load-bearing field for #51 chunk-mode raw-axis
  // indices (architect HIGH fix). Mutation hypothesis: a regression
  // that stops setting rawIndex (or sets it to local-word index
  // instead of source-array position) silently corrupts chunk bounds
  // for any article with paragraph or dash tokens — this test pins
  // the invariant `out[i].rawIndex === i` for word tokens across a
  // mixed-kind stream.
  it('rawIndex on word tokens matches source array position (mixed-kind stream)', () => {
    const tokens = tokenize('a\n\nb — c.');
    const marks = markSentenceBoundaries(tokens);
    expect(marks.length).toBe(tokens.length);
    marks.forEach((m, i) => {
      if (m.kind === 'word') {
        expect(m.rawIndex).toBe(i);
      }
    });
    // Spot-check: the second word `b` lives at index 2 (after the
    // paragraph sentinel); the third word `c.` lives at index 4
    // (after the em-dash).
    const wordPositions = marks
      .map((m, i) => (m.kind === 'word' ? { rawIndex: m.rawIndex, srcPos: i } : null))
      .filter((x): x is { rawIndex: number; srcPos: number } => x !== null);
    expect(wordPositions).toEqual([
      { rawIndex: 0, srcPos: 0 },
      { rawIndex: 2, srcPos: 2 },
      { rawIndex: 4, srcPos: 4 },
    ]);
  });
});
