/**
 * URL canonicalization for the reading-position store (#48).
 *
 * Two browser visits to "the same article" should collapse to the same
 * storage key so that closing and revisiting via a fresh share link
 * (with utm tags, with a #fragment, or with a differently-cased host)
 * still triggers the resume path.
 *
 * Rules:
 *   - Only `http:` and `https:` URLs canonicalize; every other scheme
 *     (javascript:, data:, blob:, chrome:, chrome-extension:, file:,
 *     about:, ws/wss, mailto:, tel:, etc.) returns `null`. The store's
 *     read/write paths treat `null` as "skip persistence" so reader
 *     state is never written for non-readable origins.
 *   - Length-capped at `MAX_CANONICAL_URL_LENGTH`. The cap protects the
 *     storage layer (per-entry size budget against the 5 MB
 *     chrome.storage.local quota) AND limits the attack surface for
 *     pathological URLs that would dominate the LRU index.
 *   - Drop the URL fragment (`#...`).
 *   - Drop any query param whose name starts with `utm_` (tracking).
 *   - Lowercase the host (path remains case-sensitive — many servers
 *     still serve content keyed off path case).
 *   - Preserve everything else (query order, other params, port,
 *     userinfo).
 *   - Defensive: if the input cannot be parsed as a URL, return `null`.
 *     Canonicalization runs on the activation hot path and MUST NOT
 *     throw — but garbage in cannot become a valid storage key.
 *
 * Pure — no `chrome.*`, no DOM. Lives under `src/core/` per the
 * boundary contract in `src/core/README.md`.
 */

const UTM_PREFIX = 'utm_';

/**
 * Allow-list of URL schemes the store will persist. Anything else
 * resolves to `null` (skip persistence).
 *
 * - `http:` / `https:` — the only schemes for which a "reading
 *   position" has any meaning. The reader resumes on revisit to the
 *   same URL; non-web schemes either don't navigate (`javascript:`),
 *   carry the content in the URL itself (`data:`, `blob:`), or expose
 *   sensitive extension/system surfaces (`chrome:`,
 *   `chrome-extension:`, `file:`, `about:`).
 *
 * Persisting non-web URLs is also a privacy hazard — `data:` and
 * `blob:` URLs can be megabytes long; `chrome-extension://<id>/...`
 * leaks extension IDs across the store; `file://` exposes local paths.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Cap on the canonical URL length. 2048 is the historical practical
 * cap most servers honor and a safe upper bound for storage-key
 * budgets. Anything longer is either pathological tracker noise or a
 * server-rendered URL we can't reliably re-derive on revisit, so the
 * store skips persistence rather than write a slot we cannot match
 * against later.
 */
export const MAX_CANONICAL_URL_LENGTH = 2048;

/**
 * Returns the canonical URL string for `input`, or `null` when `input`
 * is not a persistable URL (disallowed scheme, unparseable, or longer
 * than `MAX_CANONICAL_URL_LENGTH` after canonicalization).
 *
 * Callers that persist data keyed by URL MUST treat `null` as "skip"
 * — do not coerce to empty string, do not fall back to `input`.
 */
export function canonicalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return null;
  }

  // Lowercase host. `URL.host` setter handles port preservation.
  url.host = url.host.toLowerCase();

  // Drop the fragment. Setting hash = '' yields a URL with no `#`.
  url.hash = '';

  // Drop utm_* params. URLSearchParams.delete mutates in place and
  // preserves the relative order of remaining entries.
  const drop: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (key.startsWith(UTM_PREFIX)) drop.push(key);
  }
  for (const key of drop) {
    url.searchParams.delete(key);
  }

  const canonical = url.toString();
  if (canonical.length > MAX_CANONICAL_URL_LENGTH) {
    return null;
  }
  return canonical;
}
