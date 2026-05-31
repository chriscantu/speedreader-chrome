/**
 * Relative-time formatter for the popup "Recently read" surface (issue #49).
 *
 * Hand-rolled rather than `Intl.RelativeTimeFormat`-backed for two reasons:
 *   1. Locale-stable test output — Intl varies by user locale, making
 *      assertions brittle without locale pinning at the test boundary.
 *   2. The output set is tiny (Just now / Xm / Xh / Yesterday / X days /
 *      "MMM D" / "MMM D, YYYY"). Intl is overweight for the surface.
 *
 * Edge cases — all collapse to "Just now":
 *   - Future timestamps (clock drift between writer and reader)
 *   - NaN / Infinity / -Infinity timestamps
 *   - NaN `now` (broken clock — defensive)
 *
 * The Safari upstream's "Recently read" surface does not exist (Safari
 * has no equivalent feature today), so there is no parity constraint
 * on the exact string set — see project memory note
 * `project_safari_no_context_menu.md` for the comparable precedent.
 *
 * Pure — no `chrome.*`, no DOM. Lives under `src/core/` per the boundary
 * contract in `src/core/README.md`.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatRelativeTime(timestamp: number, now: number): string {
  // Defensive guards — any non-finite input collapses to "Just now" rather
  // than emitting "NaNm ago" or crashing on arithmetic.
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 'Just now';

  const delta = now - timestamp;

  // Future timestamps (negative delta) → "Just now". Clock drift between
  // the writer (content-script tab) and the reader (popup) shouldn't
  // produce a confusing "in 3 minutes" string.
  if (delta < 0) return 'Just now';

  if (delta < MINUTE_MS) return 'Just now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`;
  if (delta < 2 * DAY_MS) return 'Yesterday';
  if (delta < WEEK_MS) return `${Math.floor(delta / DAY_MS)} days ago`;

  // ≥ 7 days — switch to absolute date. Year suffix only when the
  // timestamp's year differs from `now`'s year (keeps the common
  // "earlier this year" case terse).
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const month = MONTHS_SHORT[date.getMonth()];
  const day = date.getDate();
  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${date.getFullYear()}`;
}
