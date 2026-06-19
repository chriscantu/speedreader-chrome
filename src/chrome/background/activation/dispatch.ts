/**
 * Activation dispatch funnel — the single seam between activation sources
 * (commands hotkey, context menu, popup) and the read-session wire.
 *
 * Per the SW-lifecycle ADR (`docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`)
 * and spec (`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`), every
 * source MUST normalize to an `ActivationIntent` and pass through this
 * function. The core flow is one branchless path:
 *
 *   1. tab URL lookup
 *   2. restricted-URL guard (`src/core/restricted.ts`)
 *   3. content-script injection via `chrome.scripting.executeScript`
 *   4. post-injection TOCTOU recheck (`isRestricted` against the
 *      post-resolve URL — issue #129)
 *   5. handoff to the CS via `chrome.tabs.sendMessage({type: 'activate-reader'})`
 *
 * `intent.source` is consulted ONLY for payload normalization (extracting
 * `selectionText` from the `contextMenu` variant). The flow is
 * source-blind.
 *
 * Errors from any step are converted to `Result.err` — exceptions never
 * leak across the funnel boundary. The Port handoff itself is owned by
 * the messaging-contract spec (`docs/superpowers/specs/2026-05-08-messaging-contract.md`);
 * this funnel only hands off the one-shot `activate-reader` RPC. The
 * `rsvp-session` Port is opened separately by the popup or the CS per
 * that spec.
 */

/// <reference types="@crxjs/vite-plugin/client" />

import type { Overrides } from '../../../core/messaging/validate';
import { isRestricted } from '../../../core/restricted';
import type { ActivationError, ActivationIntent, Result } from './types';

// `?script` is the crxjs vite-plugin pattern for referencing a script entry
// from another extension surface. The default export is the filename of the
// emitted loader (e.g., `assets/index.ts-<hash>.js`) — i.e., the path that
// `chrome.scripting.executeScript({ files })` resolves against the BUILT
// extension. At dev / build time crxjs registers the entry with Rollup and
// emits the corresponding chunk; the `.ts` source is never referenced at
// runtime. See `node_modules/@crxjs/vite-plugin/client.d.ts`.
import CONTENT_SCRIPT_FILE from '../../content/index.ts?script';
export { CONTENT_SCRIPT_FILE };

/**
 * SW-side in-flight injection dedup. Per the SW-lifecycle activation spec
 * §"Idempotent Content-Script Injection" → "SW-side: in-flight promise
 * dedup", concurrent `dispatchActivation` calls for the same `tabId` MUST
 * share a single underlying `chrome.scripting.executeScript`. This map
 * holds the in-flight injection promise per tab; later callers await the
 * same promise and skip a second `executeScript` call.
 *
 * Lock is keyed on `(tabId, url)`: a follower reuses the cached promise
 * ONLY when its observed URL matches the leader's. A tab that has
 * navigated mid-flight presents a new URL identity, so the follower
 * fires its own injection rather than handing off against a navigated
 * page (issue #129 reverse race — cache coherence).
 *
 * Entry cleared on settle (`.finally`) so the next genuine dispatch can
 * re-inject (e.g., after a CS tear-down or page navigation). The map only
 * dedups CONCURRENT injections — once an injection has completed and the
 * entry has cleared, a later dispatch will inject again. CS-side
 * re-registration is guarded by a separate window sentinel
 * (`window.__SPEEDREADER_INJECTED__`) per the same spec section; that
 * layer is tracked separately and is not the subject of this in-flight
 * dedup.
 *
 * OQ-2 of the context-menu integration spec
 * (`docs/superpowers/specs/2026-05-25-context-menu-integration.md`)
 * gates on this map's correctness — the collision test asserts exactly
 * one `executeScript` call across two near-simultaneous dispatches for
 * the same tab.
 */
interface InjectionLock {
  url: string;
  promise: Promise<void>;
  /**
   * Issue #138 — abort signal for the tab-id reuse residual race.
   * Set by the `chrome.tabs.onRemoved` listener when the tab whose
   * injection this lock represents is closed. Chrome's
   * `scripting.executeScript` has no cancellation API; the underlying
   * call may still resolve against a reused tab id. Followers awaiting
   * `promise` and the leader's `.finally` both check this flag and
   * surface `inject-failed` if set, so a successful resolve against a
   * reused tab does not silently land the activation.
   */
  aborted: boolean;
}
const injectionLocks = new Map<number, InjectionLock>();

/**
 * Issue #141 — per-tab tracking of ALL in-flight `InjectionLock` instances.
 *
 * `injectionLocks` above is a URL-keyed dedup cache: it holds only the
 * CURRENT slot owner for a tabId. When a URL change causes dispatch B
 * to replace dispatch A's slot, A's lock is still in flight but no
 * longer reachable via `injectionLocks.get(tabId)`. If
 * `chrome.tabs.onRemoved` fired in that window and consulted only the
 * dedup map, it would mark B aborted but leave A's stale
 * `aborted=false` in place — A's leader would then return `{ ok: true }`
 * against a closed/reused tab.
 *
 * This set is the abort-target registry: every in-flight lock for a
 * given tabId is added on dispatch start and removed on settle. The
 * `onRemoved` listener iterates this set so EVERY in-flight lock (slot
 * owner or orphaned by a later URL-mismatch replacement) observes the
 * abort flag.
 *
 * Job separation:
 *   - `injectionLocks` — URL-keyed dedup cache ("who do followers join?")
 *   - `inFlightByTab`  — abort-target registry ("who must be aborted on tab close?")
 */
const inFlightByTab = new Map<number, Set<InjectionLock>>();

/**
 * Defensive ceiling on a single `chrome.scripting.executeScript` call.
 * Per issue #128, an injection that never settles would pin its lock
 * entry for the SW lifetime and silently deadlock subsequent dispatches
 * on the same tab. The race timer surfaces a hung injection as
 * `inject-failed` and clears the slot.
 *
 * Accepted residuals (issue #139, surfaced by the antagonistic-ring
 * arbiter on PR #137 — see issues #128, #137, #139):
 *
 *   1. SW idle-shutdown inversion. Every dispatch arms a 5 s timer.
 *      MV3 idle-shutdown is ~30 s of no events / no pending timers, so
 *      the SW stays alive at least 5 s past the last `executeScript`
 *      settle even on the happy path. A stream of one dispatch every
 *      ~4 s effectively pins the SW awake indefinitely.
 *
 *   2. Inner-promise long-tail retention. On the timeout reject path
 *      below, `withInjectionTimeout` rejects the outer promise but the
 *      `inner` IIFE keeps running and retains `tabId`, the file-path
 *      argument, and a microtask-queue slot until Chrome eventually
 *      settles `executeScript`. In the pathological never-settles case
 *      this defensive timer exists to defend against, retention lasts
 *      until SW restart.
 *
 * Decision: residuals ACCEPTED. We do not wrap `inner` in an
 * `AbortController` because `chrome.scripting.executeScript` does not
 * honor abort signals today — a wrapper would drop our reference but
 * not stop the underlying call, adding code for no observable win.
 * Removing the 5 s ceiling is out of scope per issue #128 (it is the
 * defensive bound against silent activation deadlock). Revisit if/when
 * `chrome.scripting` grows real cancellation.
 */
const INJECTION_TIMEOUT_MS = 5000;

/**
 * Sentinel `details` value embedded in the `inject-failed` error when
 * the abort flag is observed (i.e., the tab was closed mid-injection
 * — see issue #138). Distinguishes the abort path from the rejection
 * path (where `details` is the original thrown error). Callers that
 * want to branch on the cause can compare against this constant.
 */
export const INJECT_FAILED_TAB_REMOVED = 'tab-removed' as const;

/**
 * Wrap a promise in a timeout race. The timer is cleared on either
 * settle path so the timeout cannot fire (or leak) once the inner
 * promise has resolved.
 */
function withInjectionTimeout(inner: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`inject timeout after ${ms}ms`)), ms);
    inner.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Tab-removed listener. Drops any in-flight lock for a tab that has
 * been closed so the orphan entry doesn't persist for the SW lifetime
 * (issue #128). Registered synchronously at module load per
 * MV3-listener discipline — SW restart re-evaluates this module and
 * re-attaches the listener.
 *
 * Guarded against `chrome` being absent because this module is imported
 * transitively by `route.ts`, and `route.test.ts` exercises the routing
 * logic via dependency injection without installing a chrome stub. In
 * the MV3 service worker `chrome` is always defined; the guard is
 * load-time resilience, not a runtime branch we expect to take.
 */
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    // Issue #141 — iterate ALL in-flight locks for this tabId, not just
    // the current slot owner. A URL-mismatch replacement (dispatch B
    // evicting dispatch A's slot mid-flight) leaves A's lock orphaned
    // in `injectionLocks` but still tracked here. Without iterating
    // every entry, A's `aborted` flag would stay false and its leader
    // would settle ok against a closed tab.
    const inFlight = inFlightByTab.get(tabId);
    if (inFlight) {
      for (const entry of inFlight) {
        entry.aborted = true;
      }
      inFlightByTab.delete(tabId);
    }
    injectionLocks.delete(tabId);
  });
}

/**
 * Idempotently inject the content script into `tabId`. Returns a `Result`
 * — never throws. Concurrent calls for the same `(tabId, url)` share one
 * underlying `chrome.scripting.executeScript` call. A follower observing
 * a URL different from the cached entry fires its own injection. A hung
 * injection is bounded by `INJECTION_TIMEOUT_MS` and surfaces as
 * `inject-failed`.
 */
async function ensureContentScript(
  tabId: number,
  url: string,
): Promise<Result<void, ActivationError>> {
  const cached = injectionLocks.get(tabId);
  if (cached && cached.url === url) {
    try {
      await cached.promise;
      if (cached.aborted) {
        return {
          ok: false,
          error: { kind: 'inject-failed', tabId, details: INJECT_FAILED_TAB_REMOVED },
        };
      }
      return { ok: true, data: undefined };
    } catch (details) {
      return { ok: false, error: { kind: 'inject-failed', tabId, details } };
    }
  }

  const inner = (async () => {
    // Issue #135 — top-frame-only invariant. The dedup key is
    // `(tabId, url)` where `url` is the top-level document URL from
    // `chrome.tabs.get(tabId).url`. Adding `allFrames: true` or
    // `frameIds: [...]` here would inject into subframes whose URL
    // identity is NOT tracked by the lock key; an attacker-controlled
    // subframe could navigate independently and bypass the URL
    // recheck. If subframe injection becomes a requirement, extend
    // the lock key to `(tabId, frameId, url)` and enumerate frames in
    // the post-recheck.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  })();

  // The leader and any followers hold local references to `entry`
  // through `await cached.promise` (followers) or the closure around
  // `promise.finally` (leader). The `onRemoved` listener mutates
  // `entry.aborted` by iterating `inFlightByTab.get(tabId)` — even
  // after the dedup-map slot has been replaced or deleted, the entry
  // object itself survives in the per-tab set (and via those local
  // references) so the abort flag remains observable to the awaiting
  // leader / follower (issue #141).
  // Definite-assignment assertion: `entry` is assigned below before the
  // `.finally` closure can run (the closure only fires after `promise`
  // settles, which is after `entry` is constructed). Forward declaration
  // is needed so the closure can drop this specific lock from
  // `inFlightByTab` regardless of whether it's still the slot owner in
  // `injectionLocks` (a later URL-mismatch dispatch may have replaced
  // the slot — issue #141).
  // Capture the specific Set instance for THIS entry's lifecycle. After
  // `onRemoved(tabId)` deletes the map slot, a subsequent dispatch on the
  // same tabId installs a FRESH `Set` instance. The orphan leader's
  // `.finally` must operate on the Set it originally added to — not on
  // whatever Set `inFlightByTab.get(tabId)` returns at settle time, which
  // may belong to a different generation of in-flight locks. The
  // `=== mySet` guard before `inFlightByTab.delete(tabId)` ensures the
  // orphan never evicts a fresh-generation slot installed after its
  // tab was closed (PR #143 review).
  //
  /* eslint-disable prefer-const -- forward-declared for .finally closure capture */
  let entry!: InjectionLock;
  let mySet!: Set<InjectionLock>;
  /* eslint-enable prefer-const */
  const promise = withInjectionTimeout(inner, INJECTION_TIMEOUT_MS).finally(() => {
    // Only clear our own entry — a later dispatch on a different URL may
    // have replaced the slot while we were in flight, or the
    // `chrome.tabs.onRemoved` listener may have already evicted it.
    const current = injectionLocks.get(tabId);
    if (current?.promise === promise) {
      injectionLocks.delete(tabId);
    }
    // Issue #141 + PR #143 review — drop this lock from the per-tab
    // in-flight Set we ORIGINALLY added to (captured as `mySet` below).
    // Only delete the tabId map key if it still points at our Set —
    // never evict a Set installed by a later dispatch on a reused
    // tabId.
    mySet.delete(entry);
    if (mySet.size === 0 && inFlightByTab.get(tabId) === mySet) {
      inFlightByTab.delete(tabId);
    }
  });
  entry = { url, promise, aborted: false };
  injectionLocks.set(tabId, entry);
  let set = inFlightByTab.get(tabId);
  if (!set) {
    set = new Set();
    inFlightByTab.set(tabId, set);
  }
  set.add(entry);
  mySet = set;

  try {
    await promise;
    if (entry.aborted) {
      return {
        ok: false,
        error: { kind: 'inject-failed', tabId, details: INJECT_FAILED_TAB_REMOVED },
      };
    }
    return { ok: true, data: undefined };
  } catch (details) {
    return { ok: false, error: { kind: 'inject-failed', tabId, details } };
  }
}

/**
 * Test-only accessors for `inFlightByTab` invariants. Used by
 * `eviction.test.ts` to assert per-tab Set state without exposing the
 * raw Map (which would let tests mutate it). Prefixed with `__test`
 * so the symbol is greppable and obviously not production API.
 */
export function __testHasInFlight(tabId: number): boolean {
  return inFlightByTab.has(tabId);
}
export function __testGetInFlightSize(tabId: number): number {
  return inFlightByTab.get(tabId)?.size ?? 0;
}
/**
 * Test-only: get the live Set instance for a tabId. Used to spy on
 * `.delete` to detect orphan-leader cross-Set contamination (PR #143
 * Set-instance-capture race regression test).
 */
export function __testGetInFlightSet(tabId: number): Set<unknown> | undefined {
  return inFlightByTab.get(tabId);
}

/**
 * Payload sent to the content script on activation. Mirrors the
 * `activate-reader` one-shot RPC added by the SW-lifecycle spec to the
 * messaging-contract `Msg` union; extended additively by the context-menu
 * integration spec §"Activation Payload Extension" with the optional
 * `overrides` slot.
 */
interface ActivateReaderMessage {
  type: 'activate-reader';
  scope: 'selection' | 'full';
  overrides?: Overrides;
}

/**
 * Normalize a source-specific intent into the scope payload the CS expects.
 * This is the ONLY place `intent.source` is inspected — the rest of the
 * funnel is source-blind.
 *
 * Scope rules:
 * - `contextMenu` with `selectionText !== undefined` AND `menuItemId` of a
 *   preset (`speedreader.ctx.preset.*`) → `'selection'`. Toggle items
 *   never reach this funnel (the listener short-circuits to a settings
 *   write), so the only contextMenu intents arriving here are preset
 *   clicks; the `startsWith` check is defense-in-depth.
 * - all other intents → `'full'`.
 *
 * Overrides are forwarded only for the contextMenu source. The key is
 * omitted (not set to `undefined`) when not applicable so existing
 * popup-source and command-source callers observe identical payload
 * shape — `expect(payload).not.toHaveProperty('overrides')` stays true.
 */
function intentToActivatePayload(intent: ActivationIntent): ActivateReaderMessage {
  const isPresetSelection =
    intent.source === 'contextMenu' &&
    intent.selectionText !== undefined &&
    intent.menuItemId.startsWith('speedreader.ctx.preset.');
  // Issue #18 — popup carries its own scope (Read article vs Read selection).
  // Default to `'full'` when omitted to preserve prior popup behavior.
  const isPopupSelection = intent.source === 'popup' && intent.scope === 'selection';
  const scope: ActivateReaderMessage['scope'] =
    isPresetSelection || isPopupSelection ? 'selection' : 'full';
  const base = { type: 'activate-reader' as const, scope };
  return intent.source === 'contextMenu' && intent.overrides
    ? { ...base, overrides: intent.overrides }
    : base;
}

/**
 * Issue #243 — bounded cold-start handoff retry.
 *
 * With lazy injection (#142) the content script is injected only on the
 * activating dispatch, so on a cold start the just-injected CS message
 * listener may not yet be registered when step-5
 * `chrome.tabs.sendMessage` fires. The send then rejects with
 * "Could not establish connection" and the funnel returns
 * `handoff-failed` — alarming and unactionable for what is a
 * deterministic internal race, not a real lost connection.
 *
 * The handoff (and ONLY the handoff) is retried a bounded number of
 * times with a short backoff. `HANDOFF_MAX_ATTEMPTS` is the TOTAL number
 * of `sendMessage` attempts (initial + retries); the backoff fires
 * between attempts (`HANDOFF_MAX_ATTEMPTS - 1` times). The retry is
 * scoped to the `sendMessage` reject path at step 5 — `restricted-page`
 * (steps 2/4) and `inject-failed` (step 3) are earlier and still surface
 * immediately with no retry.
 *
 * A full CS-ready handshake / messaging-contract redesign is the durable
 * fix and is deferred; this bounded retry absorbs the cold-start window
 * without that redesign.
 */
export const HANDOFF_MAX_ATTEMPTS = 3;
const HANDOFF_BACKOFF_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for {@link dispatchActivation}. `sleep` is injectable so the
 * cold-start retry backoff is deterministic under test (no fake timers,
 * no wall-clock delay). Production callers omit it and get the real
 * `setTimeout`-backed backoff.
 */
export interface DispatchOptions {
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Dispatch an activation intent. Returns a `Result` — never throws.
 */
export async function dispatchActivation(
  intent: ActivationIntent,
  options: DispatchOptions = {},
): Promise<Result<void, ActivationError>> {
  const sleep = options.sleep ?? defaultSleep;
  // 1. Resolve the tab URL. tabs.get can reject (closed tab, race).
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(intent.tabId);
  } catch (details) {
    return { ok: false, error: { kind: 'tab-unavailable', tabId: intent.tabId, details } };
  }

  const url = tab.url ?? '';

  // 2. Restricted-URL guard. `chrome.runtime.id` is the call-site lookup
  //    that keeps `isRestricted` platform-agnostic.
  if (isRestricted(url, chrome.runtime.id)) {
    return { ok: false, error: { kind: 'restricted-page', url } };
  }

  // 3. Inject the content script idempotently. `ensureContentScript`
  //    dedupes concurrent injections per `(tabId, url)` so two
  //    near-simultaneous activations (e.g., context-menu click + #34
  //    hotkey) on the same page share one `chrome.scripting.executeScript`
  //    call. A tab that navigated mid-flight presents a different URL
  //    identity, so a follower fires its own injection (issue #129).
  //    Rejections (TOCTOU restricted URLs, etc.) surface as `inject-failed`.
  const injectResult = await ensureContentScript(intent.tabId, url);
  if (!injectResult.ok) {
    return injectResult;
  }

  // 4. Post-injection TOCTOU recheck (issue #129). The tab may have
  //    navigated between the step-2 guard and the now-resolved
  //    `executeScript`. Re-fetch the URL and re-run `isRestricted`
  //    before the handoff so a flip to a restricted origin surfaces as
  //    `restricted-page` (the typed error for this case) rather than
  //    leaking through as a silent handoff or a generic `inject-failed`.
  let postUrl: string;
  try {
    const postTab = await chrome.tabs.get(intent.tabId);
    postUrl = postTab.url ?? '';
  } catch (details) {
    return { ok: false, error: { kind: 'tab-unavailable', tabId: intent.tabId, details } };
  }
  if (isRestricted(postUrl, chrome.runtime.id)) {
    return { ok: false, error: { kind: 'restricted-page', url: postUrl } };
  }

  // 5. Hand off to the CS via the `activate-reader` one-shot RPC. The
  //    `rsvp-session` Port is opened separately by the popup / CS per
  //    the messaging-contract spec.
  //
  //    Issue #243 — bounded cold-start retry. On a cold start the
  //    just-injected CS listener (#142 lazy injection) may not yet be
  //    registered, so the first `sendMessage` rejects with "Could not
  //    establish connection". Retry the handoff up to
  //    `HANDOFF_MAX_ATTEMPTS` total attempts with a short backoff before
  //    surfacing `handoff-failed`. ONLY this reject path retries — the
  //    earlier restricted/inject steps already returned above.
  const payload = intentToActivatePayload(intent);
  let lastDetails: unknown;
  for (let attempt = 1; attempt <= HANDOFF_MAX_ATTEMPTS; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(intent.tabId, payload);
      return { ok: true, data: undefined };
    } catch (details) {
      lastDetails = details;
      if (attempt < HANDOFF_MAX_ATTEMPTS) {
        await sleep(HANDOFF_BACKOFF_MS);
      }
    }
  }
  return {
    ok: false,
    error: { kind: 'handoff-failed', tabId: intent.tabId, details: lastDetails },
  };
}
