import { describe, it, expect } from 'vitest';
import { orp } from '../orp';

// ORP heuristic: Spritz-style length-bucketed table.
//   length 0       → 0 (degenerate; documented contract, does not throw)
//   length 1       → 0
//   length 2-5     → 1
//   length 6-9     → 2
//   length 10-13   → 3
//   length >= 14   → 4
//
// Surrogate pairs / grapheme clusters are out of scope for the MVP.
// The heuristic operates on UTF-16 code-unit length (String#length),
// which matches the Safari reference for ASCII / common Latin-1 inputs.

describe('orp', () => {
  it('returns 0 for the empty string (degenerate input)', () => {
    expect(orp('')).toBe(0);
  });

  it('returns 0 for a single-character word', () => {
    expect(orp('a')).toBe(0);
  });

  it('returns 1 at the 2-letter boundary', () => {
    expect(orp('of')).toBe(1);
  });

  it('returns 1 at the 5-letter upper boundary', () => {
    expect(orp('hello')).toBe(1);
  });

  it('returns 2 at the 6-letter lower boundary', () => {
    expect(orp('reader')).toBe(2);
  });

  it('returns 2 at the 9-letter upper boundary', () => {
    expect(orp('extension')).toBe(2);
  });

  it('returns 3 at the 10-letter lower boundary', () => {
    expect(orp('javascript')).toBe(3);
  });

  it('returns 3 at the 13-letter upper boundary', () => {
    expect(orp('compensating')).toBe(3); // 12
  });

  it('returns 3 at exactly 13 letters', () => {
    expect(orp('accessibility'.slice(0, 13))).toBe(3);
  });

  it('caps at 4 for 14-letter words', () => {
    expect(orp('administrative')).toBe(4); // 14
  });

  it('caps at 4 for very long words (30+ letters)', () => {
    expect(orp('a'.repeat(30))).toBe(4);
    expect(orp('internationalization')).toBe(4); // 20
  });

  it('handles common English short words', () => {
    expect(orp('the')).toBe(1);
    expect(orp('and')).toBe(1);
  });

  it('treats hyphenated forms as their full character length', () => {
    // "well-known" = 10 chars including hyphen → bucket 3
    expect(orp('well-known')).toBe(3);
  });

  it('handles non-ASCII Latin-1 (café = 4 code units) within ASCII-bias contract', () => {
    // 'café' has String#length 4 (single code units) → bucket 1
    expect(orp('café')).toBe(1);
  });
});
