/**
 * SW access-gate for the reading-position store (#196).
 *
 * Closes the cross-origin reading-history enumeration threat (#195/S3) by
 * removing `chrome.storage.local` from the content-script API surface. The SW
 * — a trusted context — calls
 * `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`,
 * after which a content script's `chrome.storage.local.get` / `get(null)` /
 * `set` all fail. The data does not move; the door is locked. See
 * `docs/superpowers/specs/2026-06-11-position-store-service-worker.md`.
 *
 * TWO LOAD-BEARING INVARIANTS (spec §Acceptance Criteria):
 *
 *  1. **No-`content_scripts` lazy-injection model is what closes the
 *     re-assertion window.** The manifest declares no `content_scripts`
 *     (`manifest.ts`); a CS exists only after a user gesture wakes the SW and
 *     the SW injects it via `chrome.scripting`. The SW (and this gate, run at
 *     module top-level on every wake) therefore always runs before any CS it
 *     spawns. **Adding a declared `content_scripts` entry requires revisiting
 *     §Lifecycle Hazards** — a document-start CS could read `local` ahead of
 *     this gate on a fresh browser launch.
 *
 *  2. **`local` is now SW-trusted-only by design.** `setAccessLevel` is
 *     area-global, not per-key. Any future content-script-side `local` need
 *     MUST route through an SW RPC, never raw `chrome.storage.local` — a raw CS
 *     `local` read or `local.onChanged` listener added after this ships will
 *     silently get access-denied / no events. Reviewers of future CS changes
 *     must treat raw `local` access as a design error.
 *
 * Re-assertion discipline: issued synchronously at module top-level on every
 * SW wake (same as listener registration). `setAccessLevel` returns a Promise —
 * only the CALL is synchronous; the change resolves on a microtask. This opens
 * no exfiltration window: the CS's only route post-injection is the SW-side
 * RPC, where access is always trusted (spec §Lifecycle Hazards fact 1).
 *
 * Min Chrome floor: `setAccessLevel` on the `local` area is Chrome 140+ (MDN
 * browser-compat-data: "Supported by all storage areas from Chrome 140").
 * `manifest.ts` pins `minimum_chrome_version` to 140 so the gate API is always
 * present on supported Chrome. The feature-detect below is defense-in-depth.
 */

/**
 * Feature-detect `setAccessLevel` and, when present, restrict `local` to
 * trusted contexts. Returns whether position persistence is enabled.
 *
 * **FAIL-CLOSED (spec §The Core Decision, normative).** When `setAccessLevel`
 * is absent (should be unreachable above the pinned floor), this returns
 * `false` and the store MUST refuse to persist — it must NEVER fall back to
 * writing `position:*` into an un-gated, content-script-readable `local`.
 * Degraded-but-safe (no resume feature) is the only acceptable failure mode;
 * reopening the enumeration threat is not.
 *
 * The call is fire-and-forget: a rejection is swallowed (logged) rather than
 * thrown, so SW startup never crashes on it.
 */
export function applyLocalAccessGate(local: chrome.storage.LocalStorageArea | undefined): boolean {
  if (!local || typeof local.setAccessLevel !== 'function') {
    return false;
  }
  // Issued synchronously; the access-level change resolves on a microtask.
  void Promise.resolve(local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })).catch(
    (err: unknown) => {
      console.warn('[speedreader] setAccessLevel(local, TRUSTED_CONTEXTS) failed', err);
    },
  );
  return true;
}

/**
 * Top-level, every-wake assertion. Whether position persistence is enabled for
 * this SW lifetime. Consumed by `background/position/store.ts` to enforce
 * fail-closed. `undefined` `chrome`/`storage.local` (non-MV3 test hosts)
 * degrades to disabled.
 */
export const POSITION_PERSISTENCE_ENABLED: boolean = applyLocalAccessGate(
  typeof chrome !== 'undefined' ? chrome.storage?.local : undefined,
);
