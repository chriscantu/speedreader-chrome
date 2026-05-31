/**
 * URL → display-label derivation for the popup "Recently read" surface
 * (issue #49).
 *
 * The reading-position store (#48) records only `{wordIndex, totalWords,
 * lastReadAt}` per URL — it does NOT persist article titles. Persisting
 * the title would require a schema bump and a content-script side
 * pickup; both are deferred to #196 (combined S3 + title PR after that
 * spec lands). Until then, the popup derives a best-effort label from
 * the URL.
 *
 * Output shape:
 *   - Bare hostname for root paths           → "example.com"
 *   - Hostname + last segment for deeper URLs → "example.com / article-title"
 *   - `www.` prefix stripped (parity with canonicalizeUrl)
 *   - Query string + fragment dropped (mirrors canonicalizeUrl)
 *   - Path segments percent-decoded for readability
 *   - Long final segments truncated to keep popup labels compact
 *   - Non-URL input returned verbatim so a corrupted store entry still
 *     renders SOMETHING in the row (vs. disappearing silently)
 *
 * Pure — no `chrome.*`, no DOM.
 */

/**
 * Total cap on label length to keep popup rows visually consistent at
 * the 280 px popup floor (CSS-side wraps long labels, but the truncation
 * here avoids the visual jitter of a 200-char segment forcing a wrap).
 */
const MAX_LABEL_LENGTH = 64;

/**
 * Cap on the path-segment portion alone. With a typical hostname of
 * ~16 chars + " / " separator (3 chars), this leaves ~45 chars for the
 * path segment before truncation — fits comfortably on one popup line.
 */
const MAX_SEGMENT_LENGTH = 44;

export function deriveTitleFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const host = stripWww(parsed.hostname.toLowerCase());

  // Pull the last non-empty segment (handles trailing slash by skipping
  // the empty tail). Percent-decode so "hello%20world" → "hello world".
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return host;

  let last: string;
  try {
    last = decodeURIComponent(segments[segments.length - 1]);
  } catch {
    last = segments[segments.length - 1];
  }

  const truncatedSegment = truncate(last, MAX_SEGMENT_LENGTH);
  const label = `${host} / ${truncatedSegment}`;
  return truncate(label, MAX_LABEL_LENGTH);
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
