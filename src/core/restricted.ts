/**
 * Restricted-URL classification.
 *
 * Pure, platform-agnostic predicate used by the activation dispatch funnel
 * (and other call sites — context-menu URL patterns, post-injection
 * fallbacks, CS-side self-checks) to decide whether SpeedReader can
 * legally inject into a given page.
 *
 * No `chrome.*` / `browser.*` imports — this file MUST live under
 * `src/core/` per the boundary contract in `src/core/README.md`.
 *
 * Allow-list discipline (see issue #122 review):
 *   The predicate is restricted UNLESS the URL parses cleanly AND its
 *   scheme is on a small, explicit allow list:
 *     - `http:` / `https:` (web content, minus Web Store hosts)
 *     - `chrome-extension:` AND `hostname === ownExtensionId` (our own
 *       extension surfaces)
 *   Every other scheme — known-restricted (`chrome:`, `devtools:`,
 *   `file:`, …) AND future schemes Chromium hasn't shipped yet
 *   (`isolated-app:`, `chrome-distiller:`, `filesystem:`, …) — falls
 *   to the default-deny branch. A deny-list misses any scheme not yet
 *   enumerated; the allow-list flip closes that gap.
 *
 * See `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"Restricted-URL Guard" and the ADR
 * `docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`.
 */

/** Hosts whose entire surface is off-limits (Chrome Web Store). */
const RESTRICTED_HOSTS = new Set<string>(['chromewebstore.google.com']);

/** Legacy Chrome Web Store path on chrome.google.com — restricted by path prefix. */
const LEGACY_WEBSTORE_HOST = 'chrome.google.com';
const LEGACY_WEBSTORE_PATH_PREFIX = '/webstore';

/**
 * Returns true if SpeedReader must not inject into the given URL.
 *
 * `chrome-extension:` URLs are allowed ONLY when their hostname (the
 * extension ID) matches `ownExtensionId`. Pass `chrome.runtime.id` from
 * the call site — this function refuses to make that lookup itself to
 * stay platform-agnostic.
 *
 * When `ownExtensionId` is omitted, all `chrome-extension:` URLs are
 * treated as restricted (the safe default for boundary code that does
 * not have the runtime ID handy).
 */
export function isRestricted(url: string, ownExtensionId?: string): boolean {
  if (!url) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  // Allow http(s), minus the Web Store hosts.
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    if (RESTRICTED_HOSTS.has(parsed.hostname)) return true;
    if (
      parsed.hostname === LEGACY_WEBSTORE_HOST &&
      parsed.pathname.startsWith(LEGACY_WEBSTORE_PATH_PREFIX)
    ) {
      return true;
    }
    return false;
  }

  // Allow our own extension's `chrome-extension://` pages.
  if (parsed.protocol === 'chrome-extension:') {
    if (!ownExtensionId) return true;
    return parsed.hostname !== ownExtensionId;
  }

  // Every other scheme — known-restricted AND future schemes Chromium
  // hasn't shipped yet — defaults to restricted.
  return true;
}
