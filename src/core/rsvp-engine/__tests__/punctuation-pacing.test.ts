import { describe, it, expect } from 'vitest';
import { calculatePunctuationDelay, PUNCTUATION_MULTIPLIER } from '../punctuation-pacing';

// Spirit-port of the 16 cases in chriscantu/speed-reader's Safari reference
// (`Resources/rsvp/word-processor.js` → `calculateDelay`). Each case asserts
// the multiplier applied to a 200ms base delay so the math is auditable in
// the test name itself.
describe('calculatePunctuationDelay', () => {
  const BASE = 200;

  it.each<[string, string | null | undefined, number, string]>([
    ['"hello" → 1.0× (no punctuation)', 'hello', PUNCTUATION_MULTIPLIER.DEFAULT, 'no punctuation'],
    ['"" → 1.0× (empty)', '', PUNCTUATION_MULTIPLIER.DEFAULT, 'empty string'],
    ['null → 1.0×', null, PUNCTUATION_MULTIPLIER.DEFAULT, 'null'],
    ['undefined → 1.0×', undefined, PUNCTUATION_MULTIPLIER.DEFAULT, 'undefined'],
    ['"Hello." → 1.5× (period)', 'Hello.', PUNCTUATION_MULTIPLIER.SENTENCE_END, 'period'],
    ['"What?" → 1.5× (question)', 'What?', PUNCTUATION_MULTIPLIER.SENTENCE_END, 'question mark'],
    ['"Stop!" → 1.5× (exclamation)', 'Stop!', PUNCTUATION_MULTIPLIER.SENTENCE_END, 'exclamation'],
    ['"word," → 1.2× (comma)', 'word,', PUNCTUATION_MULTIPLIER.CLAUSE_BREAK, 'comma'],
    ['"clause;" → 1.2× (semicolon)', 'clause;', PUNCTUATION_MULTIPLIER.CLAUSE_BREAK, 'semicolon'],
    ['"intro:" → 1.2× (colon)', 'intro:', PUNCTUATION_MULTIPLIER.CLAUSE_BREAK, 'colon'],
    [
      '"(Hello.)" → 1.5× (trailing paren after period)',
      '(Hello.)',
      PUNCTUATION_MULTIPLIER.SENTENCE_END,
      'trailing paren',
    ],
    [
      '"\\"Hi!\\"" → 1.5× (trailing quote after exclamation)',
      '"Hi!"',
      PUNCTUATION_MULTIPLIER.SENTENCE_END,
      'trailing quote',
    ],
    [
      '"end.]" → 1.5× (trailing bracket after period)',
      'end.]',
      PUNCTUATION_MULTIPLIER.SENTENCE_END,
      'trailing bracket',
    ],
    [
      '"e.g.," → 1.2× (abbreviation ending in comma)',
      'e.g.,',
      PUNCTUATION_MULTIPLIER.CLAUSE_BREAK,
      'abbrev → comma',
    ],
    [
      '"U.S.:" → 1.2× (abbreviation ending in colon)',
      'U.S.:',
      PUNCTUATION_MULTIPLIER.CLAUSE_BREAK,
      'abbrev → colon',
    ],
    [
      '"etc." → 1.5× (abbreviation ending in period)',
      'etc.',
      PUNCTUATION_MULTIPLIER.SENTENCE_END,
      'abbrev → period',
    ],
  ])('%s', (_label, input, expectedMultiplier) => {
    expect(calculatePunctuationDelay(input, BASE)).toBe(BASE * expectedMultiplier);
  });

  // Guard against the NaN footgun called out in the issue spec: even when
  // base is fractional and input is empty/nullish, output stays a number.
  it('never returns NaN for empty/nullish input', () => {
    expect(Number.isNaN(calculatePunctuationDelay(null, BASE))).toBe(false);
    expect(Number.isNaN(calculatePunctuationDelay(undefined, BASE))).toBe(false);
    expect(Number.isNaN(calculatePunctuationDelay('', BASE))).toBe(false);
  });
});
