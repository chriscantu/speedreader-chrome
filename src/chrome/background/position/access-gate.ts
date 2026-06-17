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
 * Live fail-closed signal. Persistence is enabled ONLY once `setAccessLevel`
 * has actually RESOLVED — not merely when the API is present. The store
 * consults this on every op (`store.ts`), so a `setAccessLevel` that is present
 * but REJECTS at runtime leaves this `false` and the store refuses to persist,
 * rather than write `position:*` into an `local` area that was never gated.
 * (Ring security finding #1: presence-detection is fail-OPEN on a runtime
 * rejection — the threat reopens because a CS retains raw `local` access when
 * the gate call never took effect.)
 */
let persistenceEnabled = false;

/** Whether position persistence is currently enabled (gate resolved OK). */
export function positionPersistenceEnabled(): boolean {
  return persistenceEnabled;
}

/**
 * Feature-detect `setAccessLevel` and, when present, restrict `local` to
 * trusted contexts. Flips {@link positionPersistenceEnabled} to `true` ONLY
 * after the call resolves. Returns a promise of the resolved enabled state.
 *
 * **FAIL-CLOSED (spec §The Core Decision, normative).** Persistence stays
 * disabled when `setAccessLevel` is absent (should be unreachable above the
 * pinned Chrome-140 floor) OR present-but-rejecting. The store MUST NEVER fall
 * back to writing `position:*` into an un-gated, content-script-readable
 * `local`. Degraded-but-safe (no resume feature) is the only acceptable
 * failure mode; reopening the enumeration threat is not.
 *
 * The CALL is issued synchronously (call-ordering, not resolution-ordering, is
 * what the SW-lifecycle discipline requires — spec §Lifecycle Hazards fact 1);
 * a rejection is caught (logged), never thrown, so SW startup never crashes.
 */
export function applyLocalAccessGate(
  local: chrome.storage.LocalStorageArea | undefined,
): Promise<boolean> {
  // Re-assert from a CLOSED state every time: persistence stays disabled until
  // THIS application's setAccessLevel resolves OK. Without this reset, a prior
  // enabled state would leak through the pending window (or a later rejection),
  // defeating fail-closed.
  persistenceEnabled = false;
  if (!local || typeof local.setAccessLevel !== 'function') {
    return Promise.resolve(false);
  }
  // Issued synchronously; the access-level change resolves on a microtask.
  // Persistence is enabled only on RESOLUTION — never on mere API presence.
  // The call is wrapped so a SYNCHRONOUS throw (bad-arg / area-locked on some
  // Chrome build) fails closed (persistence stays disabled) rather than
  // escaping as an uncaught exception at SW module-eval time (ring re-review:
  // availability defect on the sync-throw path).
  let pending: Promise<unknown>;
  try {
    pending = Promise.resolve(local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }));
  } catch (err: unknown) {
    console.warn('[speedreader] setAccessLevel(local, TRUSTED_CONTEXTS) threw', err);
    return Promise.resolve(false);
  }
  return pending.then(
    () => {
      persistenceEnabled = true;
      return true;
    },
    (err: unknown) => {
      persistenceEnabled = false;
      console.warn('[speedreader] setAccessLevel(local, TRUSTED_CONTEXTS) failed', err);
      return false;
    },
  );
}

// Top-level, every-wake assertion. Issued synchronously at module load (before
// the first await, same discipline as listener registration). `undefined`
// `chrome`/`storage.local` (non-MV3 test hosts) degrades to disabled.
void applyLocalAccessGate(typeof chrome !== 'undefined' ? chrome.storage?.local : undefined);
