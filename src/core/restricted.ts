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
 * See `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"Restricted-URL Guard" and the ADR
 * `docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`.
 */

/** URL schemes Chrome forbids (or that have no useful injection target). */
const RESTRICTED_SCHEMES = new Set<string>([
  'chrome:',
  'chrome-untrusted:',
  'chrome-search:',
  'devtools:',
  'view-source:',
  'about:',
  'data:',
  'javascript:',
  'file:',
  'blob:',
  'edge:',
]);

/** Hosts whose entire surface is off-limits (Chrome Web Store). */
const RESTRICTED_HOSTS = new Set<string>(['chromewebstore.google.com']);

/** Legacy Chrome Web Store path on chrome.google.com — restricted by path prefix. */
const LEGACY_WEBSTORE_HOST = 'chrome.google.com';
const LEGACY_WEBSTORE_PATH_PREFIX = '/webstore';

/**
 * Returns true if SpeedReader must not inject into the given URL.
 *
 * `chrome-extension:` URLs are restricted EXCEPT when their hostname (the
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

  if (RESTRICTED_SCHEMES.has(parsed.protocol)) return true;

  if (parsed.protocol === 'chrome-extension:') {
    if (!ownExtensionId) return true;
    return parsed.hostname !== ownExtensionId;
  }

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    if (RESTRICTED_HOSTS.has(parsed.hostname)) return true;
    if (
      parsed.hostname === LEGACY_WEBSTORE_HOST &&
      parsed.pathname.startsWith(LEGACY_WEBSTORE_PATH_PREFIX)
    ) {
      return true;
    }
  }

  return false;
}
