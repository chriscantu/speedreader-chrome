/**
 * scrubber-format.test.ts — issue #47
 *
 * Pure unit coverage for the `formatTime` + `scrubberValueText` helpers
 * exposed on `OVERLAY_TEXT`. Both are load-bearing: `formatTime` drives
 * the visible elapsed/remaining labels AND the `aria-valuetext` AT
 * surrogate; an off-by-one in the `ss` pad would silently produce
 * `1:5` instead of `1:05` (visible regression + screen-reader misread).
 */
import { describe, expect, test } from 'vitest';
import { OVERLAY_TEXT } from '../constants';

describe('OVERLAY_TEXT.formatTime', () => {
  test('zero seconds → "0:00"', () => {
    expect(OVERLAY_TEXT.formatTime(0)).toBe('0:00');
  });
  test('sub-minute pads ss to width 2', () => {
    expect(OVERLAY_TEXT.formatTime(5)).toBe('0:05');
    expect(OVERLAY_TEXT.formatTime(59)).toBe('0:59');
  });
  test('one minute → "1:00" (rolls over cleanly)', () => {
    expect(OVERLAY_TEXT.formatTime(60)).toBe('1:00');
  });
  test('mixed mm:ss', () => {
    expect(OVERLAY_TEXT.formatTime(125)).toBe('2:05');
  });
  test('hour-plus stays in mm:ss (Safari spec: no h:mm:ss)', () => {
    expect(OVERLAY_TEXT.formatTime(3661)).toBe('61:01');
  });
  test('negative input clamps to "0:00" — guards against label leak', () => {
    expect(OVERLAY_TEXT.formatTime(-5)).toBe('0:00');
  });
  test('non-finite input clamps to "0:00"', () => {
    expect(OVERLAY_TEXT.formatTime(Number.NaN)).toBe('0:00');
    expect(OVERLAY_TEXT.formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
  test('rounds (not truncates) seconds', () => {
    // 59.6 → round → 60 → carries to "1:00"; truncation would emit "0:59"
    expect(OVERLAY_TEXT.formatTime(59.6)).toBe('1:00');
  });
});

describe('OVERLAY_TEXT.scrubberValueText', () => {
  test('joins elapsed + remaining with explicit labels for AT', () => {
    expect(OVERLAY_TEXT.scrubberValueText(0, 120)).toBe('0:00 elapsed, 2:00 remaining');
    expect(OVERLAY_TEXT.scrubberValueText(75, 45)).toBe('1:15 elapsed, 0:45 remaining');
  });
});
