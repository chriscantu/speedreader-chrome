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
): RouteDeps {
  return {
    dispatchActivation: vi.fn(() => Promise.resolve(result)),
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
    const deps = makeDeps({ ok: true, data: undefined });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 42 }, popupSender(), sendResponse, deps);

    const resp = await promise;
    expect(resp).toEqual({ ok: true, data: undefined });
    expect(deps.dispatchActivation).toHaveBeenCalledWith({ source: 'popup', tabId: 42 });
  });

  it('forwards restricted-page error verbatim under activation-failed envelope', async () => {
    const activationError: ActivationError = {
      kind: 'restricted-page',
      url: 'chrome://settings',
    };
    const deps = makeDeps({ ok: false, error: activationError });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 7 }, popupSender(), sendResponse, deps);

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
    const deps = makeDeps({ ok: false, error: activationError });
    const { promise, sendResponse } = waitForResponse();

    route({ type: 'activate-reader', tabId: 11 }, popupSender(), sendResponse, deps);

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
      const deps = makeDeps({ ok: false, error: activationError });
      const { promise, sendResponse } = waitForResponse();

      route({ type: 'activate-reader', tabId: 1 }, popupSender(), sendResponse, deps);

      const resp = await promise;
      if (resp.ok) throw new Error('unreachable');
      if (resp.error.kind !== 'activation-failed') throw new Error('unreachable');
      expect(resp.error.error.kind).toBe(kind);
    }
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
