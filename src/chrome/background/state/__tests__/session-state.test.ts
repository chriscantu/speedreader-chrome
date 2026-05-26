import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinonChrome from 'sinon-chrome';

void sinonChrome;

interface SessionStub {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  storage: { session: SessionStub };
}

let store: Record<string, unknown>;

function installChromeStub(): ChromeStub {
  store = {};
  const stub: ChromeStub = {
    storage: {
      session: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete store[key];
          return Promise.resolve();
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

const VALID_STATE = {
  tabId: 42,
  scope: 'full' as const,
  wpm: 350,
  positionIndex: 17,
  sourceHash: 'abc1234567890def',
};

describe('session-state', () => {
  beforeEach(() => {
    installChromeStub();
  });
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  describe('round-trip save/load', () => {
    it('saves and loads a valid state when expectedSourceHash matches', async () => {
      const { saveSession, loadSession } = await import('../session-state');
      await saveSession(VALID_STATE);
      const loaded = await loadSession(42, VALID_STATE.sourceHash);
      expect(loaded).toEqual(VALID_STATE);
    });

    it('returns null when no session is stored for the tab', async () => {
      const { loadSession } = await import('../session-state');
      const loaded = await loadSession(999, 'whatever');
      expect(loaded).toBeNull();
    });

    it('isolates sessions per-tab', async () => {
      const { saveSession, loadSession } = await import('../session-state');
      await saveSession(VALID_STATE);
      await saveSession({ ...VALID_STATE, tabId: 99, positionIndex: 3 });

      const a = await loadSession(42, VALID_STATE.sourceHash);
      const b = await loadSession(99, VALID_STATE.sourceHash);

      expect(a?.positionIndex).toBe(17);
      expect(b?.positionIndex).toBe(3);
    });
  });

  describe('validateSession', () => {
    it('returns null on shape mismatch (missing fields)', async () => {
      const { validateSession } = await import('../session-state');
      expect(validateSession({ tabId: 1 }, 'abc1234567890def')).toBeNull();
      expect(validateSession(null, 'abc1234567890def')).toBeNull();
      expect(validateSession('not an object', 'abc1234567890def')).toBeNull();
    });

    it('returns null on wrong field types', async () => {
      const { validateSession } = await import('../session-state');
      const bad = { ...VALID_STATE, wpm: 'fast' };
      expect(validateSession(bad, VALID_STATE.sourceHash)).toBeNull();
    });

    it('returns null on invalid scope literal', async () => {
      const { validateSession } = await import('../session-state');
      const bad = { ...VALID_STATE, scope: 'other' };
      expect(validateSession(bad, VALID_STATE.sourceHash)).toBeNull();
    });

    it('returns null on sourceHash mismatch (content changed under the user)', async () => {
      const { validateSession } = await import('../session-state');
      const stored = { ...VALID_STATE, sourceHash: 'oldhash0000000000' };
      const result = validateSession(stored, 'newhash1111111111');
      expect(result).toBeNull();
    });

    it('returns the validated state on success', async () => {
      const { validateSession } = await import('../session-state');
      const result = validateSession(VALID_STATE, VALID_STATE.sourceHash);
      expect(result).toEqual(VALID_STATE);
    });

    it('rejects negative or non-integer positionIndex', async () => {
      const { validateSession } = await import('../session-state');
      expect(
        validateSession({ ...VALID_STATE, positionIndex: -1 }, VALID_STATE.sourceHash),
      ).toBeNull();
      expect(
        validateSession({ ...VALID_STATE, positionIndex: 1.5 }, VALID_STATE.sourceHash),
      ).toBeNull();
      expect(
        validateSession({ ...VALID_STATE, positionIndex: Number.NaN }, VALID_STATE.sourceHash),
      ).toBeNull();
    });
  });

  describe('loadSession integration', () => {
    it('returns null when stored payload is corrupt (shape mismatch)', async () => {
      const { saveSession, loadSession } = await import('../session-state');
      await saveSession(VALID_STATE);
      // Hand-corrupt the store after the save.
      const keys = Object.keys(store);
      expect(keys).toHaveLength(1);
      const key = keys[0] ?? '';
      store[key] = { tabId: 42, oops: true };

      const loaded = await loadSession(42, VALID_STATE.sourceHash);
      expect(loaded).toBeNull();
    });

    it('returns null when the stored sourceHash mismatches the expected one', async () => {
      const { saveSession, loadSession } = await import('../session-state');
      await saveSession(VALID_STATE);
      const loaded = await loadSession(42, 'differenthash000000');
      expect(loaded).toBeNull();
    });

    it('requires callers to supply an expectedSourceHash (compile-time guarantee)', async () => {
      const { loadSession } = await import('../session-state');
      // Type-level assertion via runtime: the second argument is required.
      // The previous signature allowed `loadSession(tabId)` which silently
      // self-compared the stored hash to itself — defeating the resume
      // guard. We assert structurally that the function has arity 2.
      expect(loadSession.length).toBe(2);
    });
  });
});
