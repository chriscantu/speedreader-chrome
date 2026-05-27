/**
 * Issue #128 — `injectionLocks` eviction + defensive timeout.
 *
 * The SW-side in-flight injection lock (`dispatch.ts:injectionLocks`)
 * had three orphan-entry paths before this fix:
 *   1. `executeScript` hangs / never settles → entry pinned for SW
 *      lifetime; subsequent dispatches on the same tab await forever.
 *   2. Tab closed mid-injection → no `chrome.tabs.onRemoved` listener;
 *      entry persists until `executeScript` eventually settles.
 *   3. SW killed mid-injection → bounded by SW lifetime; the listener
 *      and timeout together bound the in-memory orphan window.
 *
 * This suite asserts:
 *   - Module-load registers a `chrome.tabs.onRemoved` listener.
 *   - That listener clears the lock entry for the removed tab.
 *   - Calling the listener AFTER an entry has already been cleared is
 *     a safe no-op.
 *   - A hung `executeScript` is bounded by a 5 s timeout that surfaces
 *     as `inject-failed` and clears the entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ActivationIntent } from '../types';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

interface TabsStub {
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  onRemoved: { addListener: ReturnType<typeof vi.fn> };
}
interface ScriptingStub {
  executeScript: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  runtime: { id: string };
  tabs: TabsStub;
  scripting: ScriptingStub;
}

interface PendingCall {
  resolve: () => void;
  reject: (err: unknown) => void;
}

function installChromeStub(): {
  stub: ChromeStub;
  executeCalls: PendingCall[];
  onRemovedListeners: Array<(tabId: number) => void>;
  fireTabRemoved: (tabId: number) => void;
  drainExec: () => void;
} {
  const executeCalls: PendingCall[] = [];
  const onRemovedListeners: Array<(tabId: number) => void> = [];

  const stub: ChromeStub = {
    runtime: { id: OWN_ID },
    tabs: {
      get: vi.fn(() => Promise.resolve({ url: 'https://example.com/article' })),
      sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
      onRemoved: {
        addListener: vi.fn((cb: (tabId: number) => void) => {
          onRemovedListeners.push(cb);
        }),
      },
    },
    scripting: {
      executeScript: vi.fn(
        () =>
          new Promise<Array<{ frameId: number; result: undefined }>>((resolve, reject) =>
            executeCalls.push({
              resolve: () => resolve([{ frameId: 0, result: undefined }]),
              reject: (err) => reject(err),
            }),
          ),
      ),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;

  return {
    stub,
    executeCalls,
    onRemovedListeners,
    fireTabRemoved: (tabId: number) => {
      for (const cb of onRemovedListeners) cb(tabId);
    },
    drainExec: () => executeCalls.forEach((c) => c.resolve()),
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('dispatchActivation — issue #128 lock eviction', () => {
  let stub: ChromeStub;
  let executeCalls: PendingCall[];
  let fireTabRemoved: (tabId: number) => void;
  let drainExec: () => void;
  let pending: Array<Promise<unknown>>;

  beforeEach(() => {
    ({ stub, executeCalls, fireTabRemoved, drainExec } = installChromeStub());
    pending = [];
  });

  afterEach(async () => {
    drainExec();
    await Promise.allSettled(pending);
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.useRealTimers();
    vi.resetModules();
  });

  it('registers a chrome.tabs.onRemoved listener at module load', async () => {
    await import('../dispatch');
    expect(stub.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);
    const arg = stub.tabs.onRemoved.addListener.mock.calls[0]?.[0];
    expect(typeof arg).toBe('function');
  });

  it('clears the lock entry when the tab is removed mid-injection', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 77;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    // Dispatch A — fires executeScript and registers a lock entry that
    // is in flight (pending resolver, not resolved yet).
    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(executeCalls).toHaveLength(1);

    // Tab close fires while A's injection is still in flight. Listener
    // must delete the lock entry for TAB. Crucially we do NOT settle
    // A before B dispatches — without the listener, B would reuse A's
    // in-flight promise (1 executeScript call total). With the
    // listener, the slot is cleared and B fires its own (2 calls).
    fireTabRemoved(TAB);

    const pB = dispatchActivation(intent);
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Settle both so afterEach drain completes.
    executeCalls[0]?.resolve();
    executeCalls[1]?.resolve();
    await Promise.all([pA, pB]);
  });

  it('is a no-op when the listener fires after the entry has already settled', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 88;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();
    executeCalls[0]?.resolve();
    await pA;

    // Entry already cleared by the .finally on settle. Listener firing
    // now must not throw, must not corrupt the Map.
    expect(() => fireTabRemoved(TAB)).not.toThrow();

    // Subsequent dispatch still works.
    const pB = dispatchActivation(intent);
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  it('hung executeScript is bounded by a 5s timeout → inject-failed and entry cleared', async () => {
    vi.useFakeTimers();
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 99;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    // Fire dispatch — executeScript registers a pending resolver but
    // we never call it. The lock's race timer should reject after 5s.
    const pA = dispatchActivation(intent);
    pending.push(pA);
    await vi.advanceTimersByTimeAsync(0); // settle initial microtasks
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Advance fake clock past the 5000ms timeout.
    await vi.advanceTimersByTimeAsync(5001);

    const result = await pA;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');

    // Switch back to real timers and verify the entry was cleared:
    // a subsequent dispatch must fire a fresh executeScript instead of
    // awaiting the timed-out (and still-pending) promise.
    vi.useRealTimers();
    // Settle the original hung exec so afterEach drain doesn't hang.
    executeCalls[0]?.resolve();
    const pB = dispatchActivation(intent);
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  // Review H2 — a follower attached via the URL-keyed lock to a leader
  // that times out MUST also observe inject-failed. Without this assertion
  // a regression that strips error propagation through `cached.promise`
  // (e.g., swallowing the rejection) would hang or silently succeed for
  // the follower.
  it('follower attached to a timed-out leader also surfaces inject-failed', async () => {
    vi.useFakeTimers();
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 101;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pLeader = dispatchActivation(intent);
    pending.push(pLeader);
    await vi.advanceTimersByTimeAsync(0);
    const pFollower = dispatchActivation(intent);
    pending.push(pFollower);
    await vi.advanceTimersByTimeAsync(0);

    // Follower reused the leader's in-flight promise (URL match, same tab).
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5001);

    const [rL, rF] = await Promise.all([pLeader, pFollower]);
    expect(rL.ok).toBe(false);
    expect(rF.ok).toBe(false);
    if (rL.ok || rF.ok) throw new Error('unreachable');
    expect(rL.error.kind).toBe('inject-failed');
    expect(rF.error.kind).toBe('inject-failed');

    vi.useRealTimers();
    executeCalls[0]?.resolve();
  });

  // Review M4 — strengthen the post-settle no-op test: the listener for
  // tab X must not corrupt the lock entry for an unrelated tab Y. A
  // regression that did `injectionLocks.clear()` instead of
  // `.delete(tabId)` would still pass the previous test; this one fails.
  it('tab-removed for one tab does NOT evict an unrelated tab’s in-flight lock', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB_A = 201;
    const TAB_B = 202;

    const pA = dispatchActivation({ source: 'command', tabId: TAB_A });
    const pB = dispatchActivation({ source: 'command', tabId: TAB_B });
    pending.push(pA, pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Remove TAB_A while both injections are still in flight.
    fireTabRemoved(TAB_A);

    // A follower on TAB_B MUST still reuse B's in-flight lock — slot
    // for B survived the removal of A.
    const pB2 = dispatchActivation({ source: 'command', tabId: TAB_B });
    pending.push(pB2);
    await flushMicrotasks();
    // Still 2 executeScript calls total — B's slot was not evicted.
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Settle everything so drain succeeds.
    executeCalls.forEach((c) => c.resolve());
    await Promise.all([pA, pB, pB2]);
  });

  // Issue #138 — tab-id reuse residual race. When `onRemoved` fires
  // for a tab whose injection is in flight, the listener must mark the
  // lock entry as aborted in addition to deleting the slot. If the
  // underlying `executeScript` then resolves (Chrome's API has no
  // cancellation; reused tab id could land the injection elsewhere),
  // `ensureContentScript` MUST surface `inject-failed` rather than
  // returning ok against a stale/reused tab.
  it('#138: aborted flag forces inject-failed even when executeScript resolves after onRemoved', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 401;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Tab close fires while injection is in flight; listener must
    // mark entry as aborted AND delete the slot.
    fireTabRemoved(TAB);

    // Now resolve executeScript (simulating Chrome's API resolving
    // late against a reused tab). Without the abort flag, the leader
    // path would return ok.
    executeCalls[0]?.resolve();

    const result = await pA;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');
  });

  // Issue #138 — followers must also see the abort. A follower attached
  // to a leader's promise via URL match would observe the resolved
  // promise after onRemoved fires; without checking the entry's
  // aborted flag the follower would silently succeed against a
  // potentially reused tab.
  it('#138: follower attached via URL match also surfaces inject-failed on abort', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 402;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pLeader = dispatchActivation(intent);
    pending.push(pLeader);
    await flushMicrotasks();
    const pFollower = dispatchActivation(intent);
    pending.push(pFollower);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    fireTabRemoved(TAB);
    executeCalls[0]?.resolve();

    const [rL, rF] = await Promise.all([pLeader, pFollower]);
    expect(rL.ok).toBe(false);
    expect(rF.ok).toBe(false);
    if (rL.ok || rF.ok) throw new Error('unreachable');
    expect(rL.error.kind).toBe('inject-failed');
    expect(rF.error.kind).toBe('inject-failed');
  });

  // Review M3 — pin the behavior when executeScript REJECTS after the
  // abort flag has been set. Current contract: the rejection wins (the
  // catch branch returns the raw rejection's `details`) — the abort
  // signal is redundant because the result is inject-failed either way.
  // A regression that swallowed the rejection in favor of the abort
  // sentinel would change the surfaced `details` and any caller
  // branching on it would silently flip.
  it('#138: executeScript rejection AFTER onRemoved — raw rejection details wins (abort signal is redundant)', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 403;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();

    fireTabRemoved(TAB);
    const rejectErr = new Error('Frame with ID 0 was removed');
    executeCalls[0]?.reject(rejectErr);

    const result = await pA;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');
    // Raw rejection details propagate, NOT the 'tab-removed' sentinel.
    if (result.error.kind !== 'inject-failed') throw new Error('unreachable');
    expect(result.error.details).toBe(rejectErr);
  });

  // Issue #141 — slot-replace + onRemoved orphans leader's entry abort flag.
  //
  // Scenario: dispatch A on (tab T, url X) installs entryA at slot T.
  // Tab navigates to Y mid-flight. Dispatch B on (tab T, url Y) sees the
  // URL mismatch, fires its own executeScript, and replaces slot T with
  // entryB. onRemoved then fires for T. Before this fix the listener
  // consulted only `injectionLocks.get(T)` → mutated entryB only →
  // entryA's `aborted` stayed false → A's leader returned `{ ok: true }`
  // against a closed/reused tab. Fix is per-tab `Set<InjectionLock>`
  // tracked separately from the URL-keyed dedup cache.
  it('#141: slot-replace + onRemoved aborts the orphaned leader entry (entryA)', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 501;
    const URL_X = 'https://example.com/x';
    const URL_Y = 'https://example.com/y';

    // A's pre-injection tabs.get returns URL_X; B's pre-injection
    // tabs.get returns URL_Y. The URL mismatch is what causes B to
    // fire its own executeScript and replace A's slot in the dedup
    // cache. Post-recheck tabs.get calls are not reached in this
    // test (executeScript stays pending until after the abort fires).
    let getCallCount = 0;
    stub.tabs.get = vi.fn(() => {
      getCallCount += 1;
      return Promise.resolve({ url: getCallCount === 1 ? URL_X : URL_Y });
    }) as unknown as TabsStub['get'];

    // Dispatch A on URL_X.
    const pA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Dispatch B on URL_Y — URL mismatch evicts/replaces entryA in the
    // dedup cache and fires a fresh executeScript.
    const pB = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Tab close while BOTH injections are in flight. Listener must
    // mark BOTH entryA and entryB aborted — not just the slot owner
    // (entryB).
    fireTabRemoved(TAB);

    // Resolve both executeScript calls; without the fix entryA's
    // aborted flag would still be false and A's leader would return
    // ok against the closed tab.
    executeCalls[0]?.resolve();
    executeCalls[1]?.resolve();

    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.ok).toBe(false);
    expect(rB.ok).toBe(false);
    if (rA.ok || rB.ok) throw new Error('unreachable');
    expect(rA.error.kind).toBe('inject-failed');
    expect(rB.error.kind).toBe('inject-failed');
  });

  // Issue #141 — followers attached to entryA via promise reference
  // (URL match at the time of follower dispatch) must also surface
  // inject-failed when entryA is orphaned by a later URL-mismatch
  // replacement and the tab is then closed.
  it('#141: follower attached to entryA before slot-replace also surfaces inject-failed', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 502;
    const URL_X = 'https://example.com/x';
    const URL_Y = 'https://example.com/y';

    // Calls: A pre (X), A_follower pre (X), B pre (Y).
    const urls = [URL_X, URL_X, URL_Y];
    let i = 0;
    stub.tabs.get = vi.fn(() =>
      Promise.resolve({ url: urls[i++] ?? URL_Y }),
    ) as unknown as TabsStub['get'];

    const pLeaderA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pLeaderA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Follower joins entryA via URL match (URL_X).
    const pFollowerA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pFollowerA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Dispatch B on URL_Y replaces entryA in the dedup slot.
    const pB = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Tab close. Listener must mark entryA aborted even though it
    // is no longer the slot owner; both leaderA and followerA must
    // observe inject-failed.
    fireTabRemoved(TAB);

    executeCalls[0]?.resolve();
    executeCalls[1]?.resolve();

    const [rL, rF, rB] = await Promise.all([pLeaderA, pFollowerA, pB]);
    expect(rL.ok).toBe(false);
    expect(rF.ok).toBe(false);
    expect(rB.ok).toBe(false);
    if (rL.ok || rF.ok || rB.ok) throw new Error('unreachable');
    expect(rL.error.kind).toBe('inject-failed');
    expect(rF.error.kind).toBe('inject-failed');
    expect(rB.error.kind).toBe('inject-failed');
  });

  // Issue #141 — non-regression. Normal URL-replacement flow without
  // onRemoved: A's exec settles AFTER slot replacement by B. Per the
  // existing #129 semantics, A's result is whatever the underlying
  // exec returned (no abort → ok). Confirms the new in-flight tracking
  // does NOT change behavior on this path.
  it('#141: URL-replacement WITHOUT onRemoved — A still resolves ok (no regression)', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 503;
    const URL_X = 'https://example.com/x';
    const URL_Y = 'https://example.com/y';

    // Sequence of tabs.get calls in this test:
    //   1. A pre-injection  → URL_X
    //   2. B pre-injection  → URL_Y (mismatch with A's cache → B fires own exec)
    //   3. A post-recheck   → URL_Y (page has navigated by the time A's exec resolves)
    //   4. B post-recheck   → URL_Y
    // Both URL_Y values are non-restricted, so both flows reach handoff.
    const urls = [URL_X, URL_Y, URL_Y, URL_Y];
    let i = 0;
    stub.tabs.get = vi.fn(() =>
      Promise.resolve({ url: urls[i++] ?? URL_Y }),
    ) as unknown as TabsStub['get'];

    const pA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    const pB = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Resolve both — no onRemoved, no abort, both succeed.
    executeCalls[0]?.resolve();
    executeCalls[1]?.resolve();

    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
  });

  // Review L1 — the `clearTimeout` on the inner-settle path must run on
  // both branches so the timer cannot fire (or leak) after settle. A
  // regression that drops `clearTimeout` would leave `vi.getTimerCount()`
  // non-zero after the inner promise has resolved.
  it('clearTimeout fires on successful exec — no leaked timer', async () => {
    vi.useFakeTimers();
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 303;

    const pA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pA);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Settle exec immediately; the inner-settle branch of
    // `withInjectionTimeout` MUST clear the timer.
    executeCalls[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await pA;

    // After settle, no pending timers. A regression that skips
    // clearTimeout would leave the 5s timer scheduled.
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });

  // Test-gap §7 — mirror of the success-branch clearTimeout test for
  // the REJECT branch of `withInjectionTimeout`. The common error case
  // (executeScript throws) must also clear the 5s timer; a regression
  // that drops `clearTimeout` from the rejection handler would leak a
  // pending timer per failed injection.
  it('clearTimeout fires on rejected exec — no leaked timer (test-gap §7)', async () => {
    vi.useFakeTimers();
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 304;

    const pA = dispatchActivation({ source: 'command', tabId: TAB });
    pending.push(pA);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Reject exec; the rejection branch of `withInjectionTimeout` MUST
    // clear the timer alongside the resolve branch.
    executeCalls[0]?.reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(0);
    const result = await pA;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');

    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });

  // PR #143 review — N≥2 entries on the same (tabId, URL) is UNREACHABLE
  // today because the URL-keyed dedup cache short-circuits before reaching
  // the Set-add path (ensureContentScript line ~199: cache hit + URL match
  // → await cached.promise + return). The invariant is load-bearing for
  // the `inFlightByTab` Set semantics — if a future refactor moves Set-add
  // above the dedup check, or adds a per-frame lock key, this assertion
  // pins the current contract: at most one entry per (tabId) on the
  // happy-path single-URL flow.
  it('PR#143: N==1 invariant — single-URL dispatch never adds >1 entry to inFlightByTab', async () => {
    const { dispatchActivation, __testGetInFlightSize } = await import('../dispatch');
    const TAB = 601;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    // Three concurrent dispatches on the same (tabId, URL) — leader +
    // two followers. Followers join the leader via URL match and do
    // NOT add their own entries to inFlightByTab.
    const pLeader = dispatchActivation(intent);
    pending.push(pLeader);
    await flushMicrotasks();
    const pF1 = dispatchActivation(intent);
    pending.push(pF1);
    const pF2 = dispatchActivation(intent);
    pending.push(pF2);
    await flushMicrotasks();

    // One executeScript across all three; the per-tab Set has exactly
    // one entry (the leader's).
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(__testGetInFlightSize(TAB)).toBe(1);

    executeCalls[0]?.resolve();
    await Promise.all([pLeader, pF1, pF2]);
  });

  // PR #143 review — normal happy-path drain. Single dispatch, no
  // onRemoved, settle normally. After settle the Set entry MUST be
  // removed AND the tabId Map key MUST be cleared (size===0 cleanup).
  // A regression that drops `set.delete(entry)` or the empty-cleanup
  // branch leaks one entry per dispatch and one Map key per tab.
  it('PR#143: happy-path drain — inFlightByTab key removed after normal settle (test-gap §2)', async () => {
    const { dispatchActivation, __testHasInFlight } = await import('../dispatch');
    const TAB = 602;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();
    expect(__testHasInFlight(TAB)).toBe(true);

    executeCalls[0]?.resolve();
    const result = await pA;
    expect(result.ok).toBe(true);

    // After settle the .finally must have removed the entry AND the
    // map key (Set was size 1, drops to 0 → delete tabId key).
    expect(__testHasInFlight(TAB)).toBe(false);
  });

  // PR #143 review — Set-instance-capture race. The orphan leader's
  // `.finally` must operate on the Set it ORIGINALLY added to, not on
  // whatever `inFlightByTab.get(tabId)` returns at settle time.
  //
  // Sequence:
  //   1. leaderA dispatched on tab T (executeScript pending) → entryA
  //      added to setA at inFlightByTab[T].
  //   2. onRemoved(T) fires → setA detached from map.
  //   3. leaderB dispatched on (reused) tab T → fresh setB installed at
  //      inFlightByTab[T] with entryB.
  //   4. leaderA's executeScript settles → `.finally` runs.
  //
  // Discriminating signal: spy on setB.delete. Pre-fix, leaderA's
  // `.finally` calls `inFlightByTab.get(T).delete(entryA)` — i.e., calls
  // setB.delete(entryA). Post-fix, leaderA operates on its captured
  // mySet (which IS setA, now detached) — setB.delete is never invoked
  // by the orphan. The spy assertion fails pre-fix and passes post-fix.
  it('PR#143: orphan leader .finally does not touch new-generation Set after tab-id reuse', async () => {
    const { dispatchActivation, __testHasInFlight, __testGetInFlightSet } =
      await import('../dispatch');
    const TAB = 603;
    const intent: ActivationIntent = { source: 'command', tabId: TAB };

    // 1. leaderA in-flight.
    const pA = dispatchActivation(intent);
    pending.push(pA);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);

    // 2. onRemoved(TAB) — entryA orphaned, map slot deleted.
    fireTabRemoved(TAB);
    expect(__testHasInFlight(TAB)).toBe(false);

    // 3. leaderB on reused TAB → fresh setB at inFlightByTab[TAB].
    const pB = dispatchActivation(intent);
    pending.push(pB);
    await flushMicrotasks();
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);
    const setB = __testGetInFlightSet(TAB);
    expect(setB).toBeDefined();
    if (!setB) throw new Error('unreachable');
    expect(setB.size).toBe(1);

    // Spy on setB.delete BEFORE settling leaderA. Pre-fix, leaderA's
    // `.finally` would call setB.delete(entryA). Post-fix, it operates
    // on its captured mySet (setA, detached) and never touches setB.
    const setBDeleteSpy = vi.spyOn(setB, 'delete');

    // 4. leaderA settles. Discriminating assertion below.
    executeCalls[0]?.resolve();
    await pA;

    // Post-fix: setB.delete NEVER called by orphan. Pre-fix: called
    // once with entryA (no-op return but observable side effect).
    expect(setBDeleteSpy).not.toHaveBeenCalled();

    // setB state still intact; map key still present.
    expect(__testHasInFlight(TAB)).toBe(true);
    expect(setB.size).toBe(1);

    setBDeleteSpy.mockRestore();

    // Settle leaderB; .finally drains entryB and removes map key.
    executeCalls[1]?.resolve();
    await pB;
    expect(__testHasInFlight(TAB)).toBe(false);
  });
});
