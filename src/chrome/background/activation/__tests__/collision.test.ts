/**
 * OQ-2 integration test — context-menu integration spec
 * (`docs/superpowers/specs/2026-05-25-context-menu-integration.md` §"Failure
 * Modes" → "Two activation surfaces collide", AC #14, OQ-2).
 *
 * Scenario: #34 hotkey fires while the context-menu submenu is open. Both
 * dispatches enter `dispatchActivation` near-simultaneously. The spec
 * delegates to the SW-lifecycle activation spec's idempotent-injection
 * contract (`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"Idempotent Content-Script Injection"):
 *
 *   (a) exactly one `chrome.scripting.executeScript` call across both
 *       dispatches (SW-side in-flight promise dedup);
 *   (b) both `activate-reader` messages arrive at the CS in dispatch order;
 *   (c) the second message's scope cleanly replaces the first overlay's
 *       scope at the funnel boundary (CS-side overlay-state replacement is
 *       outside the funnel's surface area and not asserted here — see the
 *       reader-scope tests for that surface).
 *
 * If (a) fails, the funnel does not yet implement the idempotent-injection
 * contract referenced by the context-menu spec. That is the resolution-path
 * fork: either land the contract in `dispatch.ts`, or revise the
 * context-menu spec to pick "first-wins + drop second" or
 * "queue + serialize" semantics.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ActivationIntent } from '../types';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

interface TabsStub {
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
}
interface ScriptingStub {
  executeScript: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  runtime: { id: string };
  tabs: TabsStub;
  scripting: ScriptingStub;
}

/**
 * Install a chrome stub with deterministic, controllable async timing for
 * `executeScript` and `sendMessage`. Returning the resolvers lets each test
 * model the race: hold both calls in flight, then release in a chosen
 * order. Without external control the JS microtask queue would serialize
 * the two `dispatchActivation` calls and erase the collision window.
 */
/**
 * Pending in-flight call — settle by calling `resolve` or `reject`.
 */
interface PendingCall {
  resolve: () => void;
  reject: (err: unknown) => void;
}

function installChromeStub(): {
  stub: ChromeStub;
  executeCalls: PendingCall[];
  drainAll: () => void;
} {
  const executeCalls: PendingCall[] = [];
  const sendResolvers: Array<() => void> = [];
  let autoDrain = false;

  function pushExec(resolve: () => void, reject: (err: unknown) => void): void {
    if (autoDrain) {
      resolve();
      return;
    }
    executeCalls.push({ resolve, reject });
  }
  function pushSend(resolve: () => void): void {
    if (autoDrain) {
      resolve();
      return;
    }
    sendResolvers.push(resolve);
  }

  const stub: ChromeStub = {
    runtime: { id: OWN_ID },
    tabs: {
      get: vi.fn((_tabId: number) => Promise.resolve({ url: 'https://example.com/article' })),
      sendMessage: vi.fn(
        () => new Promise<{ ok: true }>((resolve) => pushSend(() => resolve({ ok: true }))),
      ),
    },
    scripting: {
      executeScript: vi.fn(
        () =>
          new Promise<Array<{ frameId: number; result: undefined }>>((resolve, reject) =>
            pushExec(
              () => resolve([{ frameId: 0, result: undefined }]),
              (err) => reject(err),
            ),
          ),
      ),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;

  return {
    stub,
    executeCalls,
    // Flip into auto-drain mode AND release everything already queued. Any
    // resolver registered later (e.g. a sendMessage call that fires after
    // the awaited executeScript resolves) auto-resolves on registration,
    // so awaited dispatches always terminate regardless of how many
    // executeScript / sendMessage calls the funnel made.
    drainAll: () => {
      autoDrain = true;
      executeCalls.forEach((c) => c.resolve());
      sendResolvers.forEach((r) => r());
    },
  };
}

/** Yield to the microtask queue so awaited promises can advance. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('dispatchActivation — OQ-2 hotkey/contextMenu collision', () => {
  let stub: ChromeStub;
  let executeCalls: PendingCall[];
  let drainAll: () => void;
  let pending: Array<Promise<unknown>>;

  beforeEach(() => {
    ({ stub, executeCalls, drainAll } = installChromeStub());
    pending = [];
  });

  // Drain any still-pending resolvers + awaited dispatch promises so a
  // failing assertion surfaces as the assertion itself, not as a 5 s
  // unresolved-promise timeout. Tests register their in-flight promises in
  // `pending` before any expect() that could short-circuit the test body.
  afterEach(async () => {
    drainAll();
    await Promise.allSettled(pending);
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  it('makes exactly one executeScript call across two near-simultaneous dispatches for the same tab', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 42;

    // The collision: context-menu click lands first (selection scope), then
    // the user's #34 hotkey fires before the first dispatch has completed.
    const ctxIntent: ActivationIntent = {
      source: 'contextMenu',
      tabId: TAB,
      selectionText: 'a selected phrase',
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };
    const hotkeyIntent: ActivationIntent = { source: 'command', tabId: TAB };

    const p1 = dispatchActivation(ctxIntent);
    const p2 = dispatchActivation(hotkeyIntent);
    pending.push(p1, p2);
    await flushMicrotasks();

    // Both dispatches reach the inject step before either resolves.
    // Spec contract: only ONE injection runs; the second reuses the
    // in-flight promise (activation spec §"SW-side: in-flight promise dedup").
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('both activate-reader messages arrive at the CS in dispatch order', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 42;

    const ctxIntent: ActivationIntent = {
      source: 'contextMenu',
      tabId: TAB,
      selectionText: 'a selected phrase',
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };
    const hotkeyIntent: ActivationIntent = { source: 'command', tabId: TAB };

    const p1 = dispatchActivation(ctxIntent);
    const p2 = dispatchActivation(hotkeyIntent);
    pending.push(p1, p2);
    await flushMicrotasks();

    // Resolve the in-flight injection(s) so both dispatches can advance to
    // their handoff step. Under the spec contract there is one resolver;
    // current implementation has two — drainAll covers both shapes by
    // releasing every queued executeScript resolver in order.
    drainAll();
    await flushMicrotasks();

    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(2);
    const [tabId1, payload1] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    const [tabId2, payload2] = stub.tabs.sendMessage.mock.calls[1] ?? [];

    // Dispatch order: ctx (selection) then hotkey (full). Per spec,
    // "the second activation wins" — but order is the precondition for
    // that claim; if the second arrived first, "second wins" is meaningless.
    expect(tabId1).toBe(TAB);
    expect(tabId2).toBe(TAB);
    expect(payload1).toMatchObject({ type: 'activate-reader', scope: 'selection' });
    expect(payload2).toMatchObject({ type: 'activate-reader', scope: 'full' });
  });

  it('second message cleanly replaces the first overlay scope at the funnel boundary (second-wins)', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 42;

    const ctxIntent: ActivationIntent = {
      source: 'contextMenu',
      tabId: TAB,
      selectionText: 'a selected phrase',
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };
    const hotkeyIntent: ActivationIntent = { source: 'command', tabId: TAB };

    const p1 = dispatchActivation(ctxIntent);
    const p2 = dispatchActivation(hotkeyIntent);
    pending.push(p1, p2);
    await flushMicrotasks();
    drainAll();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Both dispatches resolve ok — no half-applied state, no zombie
    // pause-state surfacing at the funnel return value.
    expect(r1).toEqual({ ok: true, data: undefined });
    expect(r2).toEqual({ ok: true, data: undefined });

    // Final delivered scope on the wire is the hotkey's full-article scope
    // (second-wins). CS-side overlay-state replacement (double-extraction
    // and zombie pause-state guards) is owned by the reader / engine tests;
    // the funnel surface only guarantees the payload it hands off.
    const lastCall = stub.tabs.sendMessage.mock.calls[stub.tabs.sendMessage.mock.calls.length - 1];
    const lastPayload = lastCall?.[1];
    expect(lastPayload).toMatchObject({ type: 'activate-reader', scope: 'full' });

    // Only one CS instance ever instantiated → no double-extraction at
    // the inject boundary (the page-level surface where double-extraction
    // would originate).
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  // Regression: both concurrent dispatches must surface the SAME inject-failed
  // Result when the shared in-flight executeScript rejects. Without this test
  // the follower's error-conversion branch in `ensureContentScript` (the
  // `await inFlight; catch` arm) is structurally unreachable from existing
  // coverage. Adversary finding: a future refactor that drops the follower's
  // catch (or misorders `.set` after `.finally`) would silently strand the
  // rejected promise as the cached value.
  it('both concurrent dispatches return inject-failed when shared executeScript rejects', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const TAB = 42;

    const ctxIntent: ActivationIntent = {
      source: 'contextMenu',
      tabId: TAB,
      selectionText: 'a selected phrase',
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };
    const hotkeyIntent: ActivationIntent = { source: 'command', tabId: TAB };

    const p1 = dispatchActivation(ctxIntent);
    const p2 = dispatchActivation(hotkeyIntent);
    pending.push(p1, p2);
    await flushMicrotasks();

    // Single in-flight executeScript reject — leader's catch returns
    // inject-failed; follower awaits the same promise and hits its own
    // distinct catch arm.
    expect(executeCalls).toHaveLength(1);
    executeCalls[0]?.reject(new Error('Cannot access contents of url'));

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (r1.ok || r2.ok) throw new Error('unreachable');
    expect(r1.error.kind).toBe('inject-failed');
    expect(r2.error.kind).toBe('inject-failed');
    expect(r1.error.kind === 'inject-failed' && r1.error.tabId).toBe(TAB);
    expect(r2.error.kind === 'inject-failed' && r2.error.tabId).toBe(TAB);

    // No handoff fired — both dispatches short-circuited at the inject step.
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  // Regression: dedup MUST key on tabId. Two near-simultaneous dispatches on
  // DIFFERENT tabs must produce TWO executeScript calls. Adversary finding:
  // a future refactor that drops the tabId key (or shares a global flag)
  // would silently collapse to one injection across the whole browser, and
  // every existing single-tab test would still pass.
  it('keys dedup on tabId — concurrent dispatches on different tabs do not share an injection', async () => {
    const { dispatchActivation } = await import('../dispatch');

    const intentTab42: ActivationIntent = { source: 'command', tabId: 42 };
    const intentTab99: ActivationIntent = { source: 'command', tabId: 99 };

    const p1 = dispatchActivation(intentTab42);
    const p2 = dispatchActivation(intentTab99);
    pending.push(p1, p2);
    await flushMicrotasks();

    // Two distinct tabs → two distinct injections.
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(2);
    const callArg1 = stub.scripting.executeScript.mock.calls[0]?.[0] as {
      target: { tabId: number };
    };
    const callArg2 = stub.scripting.executeScript.mock.calls[1]?.[0] as {
      target: { tabId: number };
    };
    expect(callArg1.target.tabId).toBe(42);
    expect(callArg2.target.tabId).toBe(99);
  });
});
