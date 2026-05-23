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

  // Invalid input rejection — exercises the assertValidWpm branch at the
  // helper boundary now that wpmToDelay is part of the public API.
  it('throws RangeError for wpm <= 0', () => {
    expect(() => wpmToDelay(0)).toThrow(RangeError);
    expect(() => wpmToDelay(-1)).toThrow(RangeError);
  });

  it('throws RangeError for non-finite wpm', () => {
    expect(() => wpmToDelay(NaN)).toThrow(RangeError);
    expect(() => wpmToDelay(Infinity)).toThrow(RangeError);
  });

  // Pins the cadence contract: helper returns raw 60000/wpm (no rounding),
  // matching the Safari reference. A future drive-by Math.round would
  // silently change cadence — this test catches that.
  it('returns unrounded fractional ms for non-divisor WPM', () => {
    expect(wpmToDelay(350)).toBeCloseTo(171.4285714, 5);
  });
});
