/**
 * URL canonicalization for the reading-position store (#48).
 *
 * Two browser visits to "the same article" should collapse to the same
 * storage key so that closing and revisiting via a fresh share link
 * (with utm tags, with a #fragment, or with a differently-cased host)
 * still triggers the resume path.
 *
 * Rules:
 *   - Drop the URL fragment (`#...`).
 *   - Drop any query param whose name starts with `utm_` (tracking).
 *   - Lowercase the host (path remains case-sensitive — many servers
 *     still serve content keyed off path case).
 *   - Preserve everything else (query order, other params, port,
 *     userinfo).
 *   - Defensive: if the input cannot be parsed as a URL, return it
 *     verbatim. Canonicalization runs on the activation hot path and
 *     MUST NOT throw.
 *
 * Pure — no `chrome.*`, no DOM. Lives under `src/core/` per the
 * boundary contract in `src/core/README.md`.
 */

const UTM_PREFIX = 'utm_';

export function canonicalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
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

  return url.toString();
}
