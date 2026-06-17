import { describe, it, expect, vi } from 'vitest';
import { handlePosition, type PositionResponse } from '../handlers';
import {
  createReadingPositionStore,
  positionKey,
  type StorageAdapter,
  type ReadingPositionStore,
} from '../../../../core/storage/reading-position';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

function spyAdapter() {
  const map = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (map.has(k)) out[k] = map.get(k);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) map.set(k, v);
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const k of keys) map.delete(k);
    }),
    getAll: vi.fn(async () => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of map.entries()) out[k] = v;
      return out;
    }),
  };
  return { adapter, map };
}

/** Resolve a position key, throwing on non-canonicalizable input (test helper). */
function key(url: string): string {
  const k = positionKey(url);
  if (k === null) throw new Error(`test: ${url} did not canonicalize`);
  return k;
}

function seed(map: Map<string, unknown>, url: string, wordIndex: number, totalWords: number): void {
  const k = key(url);
  map.set(k, { schemaVersion: 1, wordIndex, totalWords, lastReadAt: 1000 });
  const idx = (map.get('position-index') as string[] | undefined) ?? [];
  map.set('position-index', [...idx, k]);
}

function csSender(url: string | undefined): chrome.runtime.MessageSender {
  return { id: OWN_ID, url, tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 };
}
function popupSender(): chrome.runtime.MessageSender {
  return { id: OWN_ID, url: `chrome-extension://${OWN_ID}/src/chrome/popup/index.html` };
}

function makeStoreOver(adapter: StorageAdapter): ReadingPositionStore {
  return createReadingPositionStore({ adapter, now: () => 2000 });
}

async function call(
  msg: Record<string, unknown> & { type: string },
  sender: chrome.runtime.MessageSender,
  store: ReadingPositionStore,
): Promise<{ handled: boolean; resp: PositionResponse | undefined }> {
  let resp: PositionResponse | undefined;
  const sendResponse = (r: PositionResponse): void => {
    resp = r;
  };
  const handled = handlePosition(msg, sender, sendResponse, { store });
  // handlers resolve async; flush microtasks
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return { handled, resp };
}

describe('handlePosition — sender.url binding (the security invariant)', () => {
  const SENDER_URL = 'https://sender.example/article';
  const FORGED_URL = 'https://victim.example/secret';

  it('MANDATORY forged-URL shape: position/get returns the SENDER record, NOT the forged one, and never touches the forged key', async () => {
    const { adapter, map } = spyAdapter();
    seed(map, SENDER_URL, 11, 200);
    seed(map, FORGED_URL, 99, 500);
    const store = makeStoreOver(adapter);

    // CS sends position/get from sender.url===SENDER_URL, but smuggles a
    // payload.url===FORGED_URL. CS wire shape has no url field — the handler
    // MUST ignore it and bind to sender.url.
    const { resp } = await call(
      { type: 'position/get', url: FORGED_URL },
      csSender(SENDER_URL),
      store,
    );

    expect(resp?.ok).toBe(true);
    if (!resp?.ok) throw new Error('unreachable');
    // response IS the sender's record
    expect(resp.data).toMatchObject({ wordIndex: 11, totalWords: 200 });
    // AND is NOT the forged record
    expect(resp.data).not.toMatchObject({ wordIndex: 99 });
    // AND the forged key was never read or written
    const forgedKey = key(FORGED_URL);
    const touchedForged = (adapter.get as ReturnType<typeof vi.fn>).mock.calls.some(
      (args) => Array.isArray(args[0]) && args[0].includes(forgedKey),
    );
    expect(touchedForged).toBe(false);
    expect(adapter.set).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('position/set binds to sender.url, ignoring any smuggled payload url', async () => {
    const { adapter, map } = spyAdapter();
    const store = makeStoreOver(adapter);
    await call(
      { type: 'position/set', url: FORGED_URL, wordIndex: 3, totalWords: 80 },
      csSender(SENDER_URL),
      store,
    );
    // Wrote under the sender key, not the forged key.
    expect(map.has(key(SENDER_URL))).toBe(true);
    expect(map.has(key(FORGED_URL))).toBe(false);
  });

  it('position/clear binds to sender.url', async () => {
    const { adapter, map } = spyAdapter();
    seed(map, SENDER_URL, 11, 200);
    seed(map, FORGED_URL, 99, 500);
    const store = makeStoreOver(adapter);
    await call({ type: 'position/clear', url: FORGED_URL }, csSender(SENDER_URL), store);
    expect(map.has(key(SENDER_URL))).toBe(false);
    expect(map.has(key(FORGED_URL))).toBe(true);
  });
});

describe('handlePosition — null/opaque-origin reject, zero writes', () => {
  it.each([
    ['undefined sender.url', undefined],
    ['about:blank', 'about:blank'],
    ['data: URL', 'data:text/html,hi'],
    ['chrome scheme', 'chrome://settings'],
  ])('rejects %s for position/set with no write', async (_label, url) => {
    const { adapter } = spyAdapter();
    const store = makeStoreOver(adapter);
    const { resp } = await call(
      { type: 'position/set', wordIndex: 1, totalWords: 10 },
      csSender(url),
      store,
    );
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(adapter.set).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('rejects opaque-origin for position/get with no read', async () => {
    const { adapter } = spyAdapter();
    const store = makeStoreOver(adapter);
    const { resp } = await call({ type: 'position/get' }, csSender('about:blank'), store);
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(adapter.get).not.toHaveBeenCalled();
  });

  it('rejects an invalid position/set payload with no write', async () => {
    const { adapter } = spyAdapter();
    const store = makeStoreOver(adapter);
    const { resp } = await call(
      { type: 'position/set', wordIndex: 'nope' },
      csSender('https://ok.example/'),
      store,
    );
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(adapter.set).not.toHaveBeenCalled();
  });
});

describe('handlePosition — popup history surface', () => {
  it('position/list returns all entries, most-recent first', async () => {
    const { adapter, map } = spyAdapter();
    seed(map, 'https://a.example/', 1, 10);
    seed(map, 'https://b.example/', 2, 20);
    const store = makeStoreOver(adapter);
    const { resp } = await call({ type: 'position/list' }, popupSender(), store);
    expect(resp?.ok).toBe(true);
    if (!resp?.ok) throw new Error('unreachable');
    const data = resp.data as Array<{ url: string }>;
    expect(data.map((e) => e.url)).toEqual(['https://b.example/', 'https://a.example/']);
  });

  it('position/delete removes the named url (trusted popup param)', async () => {
    const { adapter, map } = spyAdapter();
    seed(map, 'https://a.example/', 1, 10);
    const store = makeStoreOver(adapter);
    const { resp } = await call(
      { type: 'position/delete', url: 'https://a.example/' },
      popupSender(),
      store,
    );
    expect(resp?.ok).toBe(true);
    expect(map.has(key('https://a.example/'))).toBe(false);
  });

  it('position/delete rejects a malformed url payload', async () => {
    const { adapter } = spyAdapter();
    const store = makeStoreOver(adapter);
    const { resp } = await call({ type: 'position/delete', url: '' }, popupSender(), store);
    expect(resp).toEqual({ ok: false, error: { kind: 'invalid-payload' } });
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('position/clear-all wipes the store', async () => {
    const { adapter, map } = spyAdapter();
    seed(map, 'https://a.example/', 1, 10);
    seed(map, 'https://b.example/', 2, 20);
    const store = makeStoreOver(adapter);
    const { resp } = await call({ type: 'position/clear-all' }, popupSender(), store);
    expect(resp?.ok).toBe(true);
    expect(map.has(key('https://a.example/'))).toBe(false);
    expect(map.has(key('https://b.example/'))).toBe(false);
    expect(map.has('position-index')).toBe(false);
  });
});

describe('handlePosition — dispatch', () => {
  it('returns false for a non-position type (lets the caller fall through)', () => {
    const handled = handlePosition({ type: 'activate-reader' }, popupSender(), () => undefined, {
      store: makeStoreOver(spyAdapter().adapter),
    });
    expect(handled).toBe(false);
  });
});
