import { describe, it, expect } from 'vitest';
import { wpmToDelay } from '../rsvp-engine';

// Cases ported from chriscantu/speed-reader Safari reference:
// tests/js/word-processor.test.js lines 158-170.
describe('wpmToDelay', () => {
  it('returns 240 ms for 250 WPM', () => {
    expect(wpmToDelay(250)).toBe(240);
  });

  it('returns 600 ms for 100 WPM', () => {
    expect(wpmToDelay(100)).toBe(600);
  });

  it('returns 100 ms for 600 WPM', () => {
    expect(wpmToDelay(600)).toBe(100);
  });
});
