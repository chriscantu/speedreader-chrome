import { describe, it, expect, vi } from 'vitest';
import { applyLocalAccessGate } from '../access-gate';

interface LocalStub {
  setAccessLevel?: ReturnType<typeof vi.fn<(opts: { accessLevel: string }) => Promise<void>>>;
  get: ReturnType<typeof vi.fn<(keys: string[]) => Promise<Record<string, unknown>>>>;
}

function makeLocal(withSetAccessLevel: boolean): LocalStub {
  const local: LocalStub = {
    get: vi.fn(async () => ({})),
  };
  if (withSetAccessLevel) {
    local.setAccessLevel = vi.fn(async () => undefined);
  }
  return local;
}

describe('applyLocalAccessGate — setAccessLevel feature-detect + fail-closed', () => {
  it('calls setAccessLevel exactly once with TRUSTED_CONTEXTS and returns true', () => {
    const local = makeLocal(true);
    const enabled = applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);

    expect(enabled).toBe(true);
    expect(local.setAccessLevel).toHaveBeenCalledTimes(1);
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('returns false and does NOT throw when setAccessLevel is absent (fail-closed)', () => {
    const local = makeLocal(false);
    let enabled: boolean | undefined;
    expect(() => {
      enabled = applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);
    }).not.toThrow();
    expect(enabled).toBe(false);
  });

  it('returns false when the local area itself is undefined', () => {
    expect(applyLocalAccessGate(undefined)).toBe(false);
  });

  it('issues setAccessLevel BEFORE any storage access (call ordering)', async () => {
    const local = makeLocal(true);
    applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);
    // Simulate the store's first storage op happening after the gate.
    await local.get(['position-index']);

    const sal = local.setAccessLevel;
    if (!sal) throw new Error('test: setAccessLevel missing');
    const gateOrder = sal.mock.invocationCallOrder[0];
    const getOrder = local.get.mock.invocationCallOrder[0];
    expect(gateOrder).toBeLessThan(getOrder);
  });

  it('swallows a setAccessLevel rejection without throwing synchronously', () => {
    const local = makeLocal(true);
    const sal = local.setAccessLevel;
    if (!sal) throw new Error('test: setAccessLevel missing');
    sal.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    expect(() =>
      applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea),
    ).not.toThrow();
  });
});
