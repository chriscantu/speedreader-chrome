/**
 * Tests for `formatRelativeTime` (issue #49 — popup "Recently read" timestamps).
 *
 * Anti-tautology stance:
 *   - Assertions pin the OUTPUT STRING for each input timestamp delta —
 *     not "Intl.RelativeTimeFormat was called with N units". The formatter
 *     is intentionally hand-rolled (no Intl dependency) for stable output
 *     across locales; testing Intl call shape would be testing the
 *     framework, not the function's contract.
 *   - Boundary tests sit on each transition (exact 60s, 60m, 24h, 7d,
 *     365d) so a regression that shifts a threshold by ±1 ms surfaces.
 */
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../format-relative-time';

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z

describe('formatRelativeTime — recent past', () => {
  it('returns "Just now" for delta = 0', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('Just now');
  });

  it('returns "Just now" for delta < 60s (30s ago)', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('Just now');
  });

  it('returns "Just now" for delta = 59s (still under the 1-minute boundary)', () => {
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('Just now');
  });

  it('returns "1m ago" at the 60s boundary (1 minute)', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1m ago');
  });

  it('returns "Xm ago" for minute deltas (2m, 30m, 59m)', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2m ago');
    expect(formatRelativeTime(NOW - 30 * 60_000, NOW)).toBe('30m ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m ago');
  });
});

describe('formatRelativeTime — hours', () => {
  it('returns "1h ago" at the 60-minute boundary', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1h ago');
  });

  it('returns "Xh ago" for hour deltas (2h, 12h, 23h)', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago');
    expect(formatRelativeTime(NOW - 12 * 3_600_000, NOW)).toBe('12h ago');
    expect(formatRelativeTime(NOW - 23 * 3_600_000, NOW)).toBe('23h ago');
  });
});

describe('formatRelativeTime — days', () => {
  it('returns "Yesterday" at the 24-hour boundary', () => {
    expect(formatRelativeTime(NOW - 24 * 3_600_000, NOW)).toBe('Yesterday');
  });

  it('returns "Yesterday" for any delta in [24h, 48h)', () => {
    expect(formatRelativeTime(NOW - 36 * 3_600_000, NOW)).toBe('Yesterday');
    expect(formatRelativeTime(NOW - (48 * 3_600_000 - 1), NOW)).toBe('Yesterday');
  });

  it('returns "X days ago" for delta in [2 days, 7 days)', () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago');
    expect(formatRelativeTime(NOW - 6 * 86_400_000, NOW)).toBe('6 days ago');
    expect(formatRelativeTime(NOW - (7 * 86_400_000 - 1), NOW)).toBe('6 days ago');
  });
});

describe('formatRelativeTime — within current year (absolute MMM D)', () => {
  it('returns absolute short-month + day for delta >= 7 days within same year', () => {
    // NOW = 2023-11-14T22:13:20Z. 10 days earlier = 2023-11-04T22:13:20Z.
    const result = formatRelativeTime(NOW - 10 * 86_400_000, NOW);
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(result).toBe('Nov 4');
  });

  it('returns absolute MMM D at exactly 7 days ago', () => {
    // 2023-11-07.
    expect(formatRelativeTime(NOW - 7 * 86_400_000, NOW)).toBe('Nov 7');
  });

  it('does not include a year suffix when same-year (180 days ago, still same year)', () => {
    // 180 days before 2023-11-14 = 2023-05-18 (still 2023).
    const result = formatRelativeTime(NOW - 180 * 86_400_000, NOW);
    expect(result).toBe('May 18');
    expect(result).not.toMatch(/2023/);
  });
});

describe('formatRelativeTime — prior years (absolute MMM D, YYYY)', () => {
  it('includes a year suffix when crossing year boundary (366 days ago)', () => {
    // 2022-11-13.
    const result = formatRelativeTime(NOW - 366 * 86_400_000, NOW);
    expect(result).toBe('Nov 13, 2022');
  });

  it('includes year when the same calendar date appears in a prior year', () => {
    // ~2 years ago, May 2022.
    const twoYears = 2 * 365 * 86_400_000;
    const result = formatRelativeTime(NOW - twoYears, NOW);
    expect(result).toMatch(/, 202[12]$/);
  });
});

describe('formatRelativeTime — edge cases', () => {
  it('returns "Just now" for future timestamps (clock drift / sync skew)', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('Just now');
    expect(formatRelativeTime(NOW + 86_400_000, NOW)).toBe('Just now');
  });

  it('returns "Just now" for NaN timestamp', () => {
    expect(formatRelativeTime(NaN, NOW)).toBe('Just now');
  });

  it('returns "Just now" for Infinity timestamp', () => {
    expect(formatRelativeTime(Infinity, NOW)).toBe('Just now');
    expect(formatRelativeTime(-Infinity, NOW)).toBe('Just now');
  });

  it('returns "Just now" when `now` is NaN (defensive — broken clock)', () => {
    expect(formatRelativeTime(NOW, NaN)).toBe('Just now');
  });
});
