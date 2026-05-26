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
});
