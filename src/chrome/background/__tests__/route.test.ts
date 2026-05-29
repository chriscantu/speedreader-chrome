import { describe, it, expect, vi } from 'vitest';
import { route, type RouteDeps, type RouteResponse } from '../route';
import type { ActivationError } from '../activation/types';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

function popupSender(): chrome.runtime.MessageSender {
  return {
    id: OWN_ID,
    url: `chrome-extension://${OWN_ID}/src/chrome/popup/index.html`,
    // tab intentionally undefined — popup-shaped
  };
}

function makeDeps(
  result: { ok: true; data: void } | { ok: false; error: ActivationError },
  opts: { activeTabId?: number | null } = {},
): RouteDeps {
  const activeTabId = opts.activeTabId;
  return {
    dispatchActivation: vi.fn(() => Promise.resolve(result)),
    getActiveTabId: vi.fn(() => Promise.resolve(activeTabId ?? null)),
  };
}

function waitForResponse(): {
  promise: Promise<RouteResponse>;
  sendResponse: (r: RouteResponse) => void;
} {
  let resolveFn!: (r: RouteResponse) => void;
  const promise = new Promise<RouteResponse>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, sendResponse: resolveFn };
}

describe('route — activate-reader handler', () => {
  it('rejects messages without a usable tabId', () => {
    const sendResponse = vi.fn();
    const deps = makeDeps({ ok: true, data: undefined });

    // popup sender has no sender.tab, msg.tabId missing → invalid-payload
    route({ type: 'activate-reader' }, popupSender(), sendResponse, deps);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'invalid-payload' },
    });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
  });

  it('returns ok envelope on successful activation', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 42 });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 42, scope: 'full' }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({ ok: true, data: undefined });
    expect(deps.dispatchActivation).toHaveBeenCalledWith({
      source: 'popup',
      tabId: 42,
      scope: 'full',
    });
  });

  // Issue #18 — popup-driven scope selection.
  it('forwards scope="selection" from popup payload into the intent', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 42 });
    const { promise, sendResponse } = waitForResponse();

    route(
      { type: 'activate-reader', tabId: 42, scope: 'selection' },
      popupSender(),
      sendResponse,
      deps,
    );

    await promise;
    expect(deps.dispatchActivation).toHaveBeenCalledWith({
      source: 'popup',
      tabId: 42,
      scope: 'selection',
    });
  });

  it('forwards scope="full" from popup payload into the intent', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 42 });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 42, scope: 'full' }, popupSender(), sendResponse, deps);

    await promise;
    expect(deps.dispatchActivation).toHaveBeenCalledWith({
      source: 'popup',
      tabId: 42,
      scope: 'full',
    });
  });

  it('rejects bogus scope values with invalid-payload — does NOT silently coerce', async () => {
    // Adversarial-ring scope F1 + security F2: the prior shape silently
    // coerced any non-whitelisted scope to `'full'`. That hid a buggy /
    // compromised popup sending an unknown scope. Reject with the same
    // envelope used for missing-tabId.
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 42 });
    const { promise, sendResponse } = waitForResponse();

    route(
      { type: 'activate-reader', tabId: 42, scope: 'bogus' },
      popupSender(),
      sendResponse,
      deps,
    );

    const resp = await promise;
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
  });

  it('rejects missing scope with invalid-payload — scope is required at the wire', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 42 });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 42 }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
  });

  it('forwards restricted-page error verbatim under activation-failed envelope', async () => {
    const activationError: ActivationError = {
      kind: 'restricted-page',
      url: 'chrome://settings',
    };
    const deps = makeDeps({ ok: false, error: activationError }, { activeTabId: 7 });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 7, scope: 'full' }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({
      ok: false,
      error: { kind: 'activation-failed', error: activationError },
    });
    // The popup MUST be able to distinguish restricted-page from inject-failed:
    if (resp.ok) throw new Error('unreachable');
    if (resp.error.kind !== 'activation-failed') throw new Error('unreachable');
    expect(resp.error.error.kind).toBe('restricted-page');
  });

  it('forwards inject-failed error verbatim — distinguishable from restricted-page', async () => {
    const activationError: ActivationError = {
      kind: 'inject-failed',
      tabId: 11,
      details: new Error('Cannot access contents'),
    };
    const deps = makeDeps({ ok: false, error: activationError }, { activeTabId: 11 });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 11, scope: 'full' }, popupSender(), sendResponse, deps);

    const resp = await promise;
    if (resp.ok) throw new Error('unreachable');
    if (resp.error.kind !== 'activation-failed') throw new Error('unreachable');
    expect(resp.error.error.kind).toBe('inject-failed');
    // Critical contract: NOT collapsed to invalid-payload.
    expect(resp.error.error.kind).not.toBe('restricted-page');
  });

  it('forwards tab-unavailable and handoff-failed verbatim', async () => {
    for (const kind of ['tab-unavailable', 'handoff-failed'] as const) {
      const activationError: ActivationError = { kind, tabId: 1 };
      const deps = makeDeps({ ok: false, error: activationError }, { activeTabId: 1 });
      const { promise, sendResponse } = waitForResponse();

      route(
        { type: 'activate-reader', tabId: 1, scope: 'full' },
        popupSender(),
        sendResponse,
        deps,
      );

      const resp = await promise;
      if (resp.ok) throw new Error('unreachable');
      if (resp.error.kind !== 'activation-failed') throw new Error('unreachable');
      expect(resp.error.error.kind).toBe(kind);
    }
  });

  it('rejects when popup-supplied tabId does not match the active tab', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: 99 });
    const { promise, sendResponse } = waitForResponse();

    // msg.tabId = 42 but active tab = 99 → mismatch → invalid-payload, no dispatch.
    route({ type: 'activate-reader', tabId: 42 }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
    expect(deps.getActiveTabId).toHaveBeenCalledTimes(1);
  });

  it('rejects when no active tab can be resolved', async () => {
    const deps = makeDeps({ ok: true, data: undefined }, { activeTabId: null });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 42 }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
  });

  it('returns invalid-payload for unknown message types', () => {
    const sendResponse = vi.fn();
    const deps = makeDeps({ ok: true, data: undefined });

    route({ type: 'unknown-thing' }, popupSender(), sendResponse, deps);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'invalid-payload' },
    });
    expect(deps.dispatchActivation).not.toHaveBeenCalled();
  });
});
