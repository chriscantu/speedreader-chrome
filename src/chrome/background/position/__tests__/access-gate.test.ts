import { describe, it, expect, vi } from 'vitest';
import { applyLocalAccessGate, positionPersistenceEnabled } from '../access-gate';

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
  it('calls setAccessLevel exactly once with TRUSTED_CONTEXTS and enables persistence on resolve', async () => {
    const local = makeLocal(true);
    const enabled = await applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);

    expect(enabled).toBe(true);
    expect(positionPersistenceEnabled()).toBe(true);
    expect(local.setAccessLevel).toHaveBeenCalledTimes(1);
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('disables persistence and does NOT throw when setAccessLevel is absent (fail-closed)', async () => {
    const local = makeLocal(false);
    let enabled: boolean | undefined;
    await expect(
      (async () => {
        enabled = await applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);
      })(),
    ).resolves.toBeUndefined();
    expect(enabled).toBe(false);
    expect(positionPersistenceEnabled()).toBe(false);
  });

  it('disables persistence when the local area itself is undefined', async () => {
    await expect(applyLocalAccessGate(undefined)).resolves.toBe(false);
    expect(positionPersistenceEnabled()).toBe(false);
  });

  // Ring security finding #1 — the regression test that was "impossible by
  // construction" under presence-detection. A present-but-REJECTING
  // setAccessLevel must leave persistence DISABLED (fail-closed), not enabled.
  it('FAIL-CLOSED on a setAccessLevel runtime rejection — persistence stays disabled, no throw', async () => {
    const local = makeLocal(true);
    const sal = local.setAccessLevel;
    if (!sal) throw new Error('test: setAccessLevel missing');
    sal.mockImplementationOnce(() => Promise.reject(new Error('boom')));

    const enabled = await applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);

    expect(enabled).toBe(false);
    expect(positionPersistenceEnabled()).toBe(false);
  });

  // Ring re-review — sync-throw path must fail closed, not crash SW startup.
  it('FAIL-CLOSED + no throw when setAccessLevel throws SYNCHRONOUSLY', async () => {
    const local = makeLocal(true);
    const sal = local.setAccessLevel;
    if (!sal) throw new Error('test: setAccessLevel missing');
    sal.mockImplementationOnce(() => {
      throw new Error('area locked');
    });

    const enabled = await applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);

    expect(enabled).toBe(false);
    expect(positionPersistenceEnabled()).toBe(false);
  });

  it('issues setAccessLevel SYNCHRONOUSLY (call-ordering: before the returned promise resolves)', () => {
    const local = makeLocal(true);
    const p = applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);
    // The CALL is synchronous — observable before we ever await the result.
    expect(local.setAccessLevel).toHaveBeenCalledTimes(1);
    return p; // settle to avoid an unhandled promise.
  });

  it('enables persistence only AFTER resolution — never on mere presence', async () => {
    const local = makeLocal(true);
    let resolveCall: (() => void) | undefined;
    local.setAccessLevel?.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveCall = () => res();
        }),
    );

    const gatePromise = applyLocalAccessGate(local as unknown as chrome.storage.LocalStorageArea);
    // Call issued, but not yet resolved → persistence must still be disabled.
    expect(local.setAccessLevel).toHaveBeenCalledTimes(1);
    expect(positionPersistenceEnabled()).toBe(false);

    resolveCall?.();
    await gatePromise;
    expect(positionPersistenceEnabled()).toBe(true);
  });
});
