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
});
