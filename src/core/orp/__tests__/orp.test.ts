import { describe, it, expect } from 'vitest';
import { orp, splitWordAtFocus } from '../orp';

// ORP heuristic ported from Safari reference:
//   chriscantu/speed-reader →
//   SpeedReader/SpeedReaderExtension/Resources/rsvp/focus-point.js
//
// Rule:
//   - Strip trailing punctuation [.,!?;:]+
//   - stripped.length <= 3  → 0
//   - else                   → floor(stripped.length * 0.3)
//
// Surrogate pairs / grapheme clusters are out of scope. Heuristic
// operates on UTF-16 code-unit length, matching Safari for ASCII /
// common Latin-1 inputs.

describe('orp', () => {
  // --- Safari parity cases (mirror tests/js/focus-point.test.js) ---

  it('returns 0 for single-character word "I" (Safari parity)', () => {
    // focus-point.test.js line 7
    expect(orp('I')).toBe(0);
  });

  it('returns 0 for two-character word "it" (Safari parity)', () => {
    // focus-point.test.js line 11
    expect(orp('it')).toBe(0);
  });

  it('returns 0 for three-character word "the" (Safari parity)', () => {
    // focus-point.test.js line 15
    expect(orp('the')).toBe(0);
  });

  it('returns 1 for "hello" (length 5, floor(5*0.3)=1) (Safari parity)', () => {
    // focus-point.test.js line 20
    expect(orp('hello')).toBe(1);
  });

  it('returns 3 for "comprehension" (length 13, floor(13*0.3)=3) (Safari parity)', () => {
    // focus-point.test.js line 25
    expect(orp('comprehension')).toBe(3);
  });

  it('returns 2 for "reading" (length 7, floor(7*0.3)=2) (Safari parity)', () => {
    // focus-point.test.js line 30
    expect(orp('reading')).toBe(2);
  });

  it('strips trailing comma: "hello," → same as "hello" (Safari parity)', () => {
    // focus-point.test.js line 35
    expect(orp('hello,')).toBe(1);
  });

  it('strips trailing period: "world." → same as "world" (Safari parity)', () => {
    // focus-point.test.js line 40
    expect(orp('world.')).toBe(1);
  });

  // --- Length-boundary cases the Safari heuristic specifically handles ---
  // Boundary at length 3 → 4 (the floor switches from 0 to floor(len*0.3)).
  // Cited against focus-point.js:12-13 in chriscantu/speed-reader.

  it('boundary: length 3 → 0 (short-word floor; focus-point.js:12)', () => {
    expect(orp('cat')).toBe(0);
  });

  it('boundary: length 4 → 1 (floor(4*0.3)=1; focus-point.js:13)', () => {
    expect(orp('four')).toBe(1);
  });

  it('boundary: length 6 → 1 (floor(6*0.3)=1; focus-point.js:13)', () => {
    expect(orp('reader')).toBe(1);
  });

  it('boundary: length 7 → 2 (floor(7*0.3)=2; focus-point.js:13)', () => {
    expect(orp('writing')).toBe(2);
  });

  it('boundary: length 10 → 3 (floor(10*0.3)=3; focus-point.js:13)', () => {
    expect(orp('javascript')).toBe(3);
  });

  // --- Chrome-side extensions of the contract ---
  // Safari does not test these directly; documented as explicit
  // extensions of the contract for engine safety.

  it('returns 0 for the empty string (degenerate; Chrome extension)', () => {
    expect(orp('')).toBe(0);
  });

  it('handles very long words via formula (length 30 → floor(30*0.3)=9)', () => {
    expect(orp('a'.repeat(30))).toBe(9);
  });

  it('handles "internationalization" (length 20 → floor(20*0.3)=6)', () => {
    expect(orp('internationalization')).toBe(6);
  });

  it('treats hyphenated forms as their full character length', () => {
    // "well-known" length 10 → floor(10*0.3)=3 (no trailing punctuation to strip)
    expect(orp('well-known')).toBe(3);
  });

  it('handles non-ASCII Latin-1 (café = 4 code units → floor(4*0.3)=1)', () => {
    expect(orp('café')).toBe(1);
  });

  it('strips multiple trailing punctuation chars: "really?!"', () => {
    // "really?!" → strip → "really" length 6 → floor(6*0.3)=1
    expect(orp('really?!')).toBe(1);
  });
});

// Mirrors Safari `splitWordAtFocus` describe block in
// chriscantu/speed-reader → tests/js/focus-point.test.js (lines 47-90).
// The splitter divides a word into the substring before the ORP, the ORP
// character itself, and the substring after it — used by the overlay to
// render the focus character in a contrasting color.
describe('splitWordAtFocus', () => {
  it('splits "comprehension" into before/focus/after (Safari parity)', () => {
    // focus-point.test.js line 48: orp=3 → 'com' | 'p' | 'rehension'
    expect(splitWordAtFocus('comprehension')).toEqual({
      before: 'com',
      focus: 'p',
      after: 'rehension',
    });
  });

  it('splits single-char "I" with empty before/after (Safari parity)', () => {
    // focus-point.test.js line 57
    expect(splitWordAtFocus('I')).toEqual({
      before: '',
      focus: 'I',
      after: '',
    });
  });

  it('splits short word "the" (Safari parity)', () => {
    // focus-point.test.js line 66: orp=0 → '' | 't' | 'he'
    expect(splitWordAtFocus('the')).toEqual({
      before: '',
      focus: 't',
      after: 'he',
    });
  });

  it('preserves trailing punctuation in after part: "hello," (Safari parity)', () => {
    // focus-point.test.js line 75: orp=1 → 'h' | 'e' | 'llo,'
    expect(splitWordAtFocus('hello,')).toEqual({
      before: 'h',
      focus: 'e',
      after: 'llo,',
    });
  });

  it('returns empty parts for empty string (Safari parity)', () => {
    // focus-point.test.js line 84
    expect(splitWordAtFocus('')).toEqual({
      before: '',
      focus: '',
      after: '',
    });
  });
});
