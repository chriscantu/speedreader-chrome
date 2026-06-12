// #196 reproducer — service worker.
//
// Owns the extension-origin IndexedDB database 'speedreader-positions' and
// writes a sentinel record at module top-level. Handles the position/* RPCs
// the spec defines, logging sender provenance (sender.url / frameId / tab?.url)
// and enforcing the null/opaque-origin guard from §Sender-URL Binding.
//
// IDB is reached via self.indexedDB (the SW global). The reproducer's whole
// point is that this handle is bound to chrome-extension://<id>; a content
// script's window.indexedDB is bound to the host page's origin and sees a
// different (empty) namespace — see content.js.

const DB_NAME = 'speedreader-positions';
const DB_VERSION = 1;
const STORE = 'positions';
const SENTINEL_KEY = 'position:https://sentinel.example/';
const SENTINEL_VALUE = {
  url: 'https://sentinel.example/',
  wordIndex: 42,
  totalWords: 100,
  source: 'sw-sentinel',
};

// Single shared open-connection PROMISE (per spec §Adapter connection discipline:
// open once at module scope, cache the promise, never indexedDB.open() per op).
const dbPromise = openDb();

function openDb() {
  return new Promise((resolve, reject) => {
    const req = self.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result ? r.result.value : null);
    r.onerror = () => reject(r.error);
  });
}

async function idbGetAll() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () =>
      resolve(r.result.map((row) => ({ url: row.value.url, position: row.value })));
    r.onerror = () => reject(r.error);
  });
}

// Seed the sentinel once on each SW wake. Idempotent (keyPath put = upsert).
dbPromise
  .then(() => idbPut(SENTINEL_KEY, SENTINEL_VALUE))
  .then(() => console.log('[idb] SW sentinel written to', DB_NAME, '->', SENTINEL_KEY))
  .catch((err) => console.error('[idb] FAIL: SW could not write sentinel:', err));

// chrome.storage.session — check 3 (restart survival). setAccessLevel is the
// cheaper-alternative knob the spec rejects; we still exercise it on every SW wake
// (it's the config the rejection rests on), but it does NOT write the sentinel.
//
// METHODOLOGY FIX: the sentinel is NO LONGER written at SW top-level. Opening ANY
// extension context (SW DevTools OR the popup) wakes the SW -> reruns this module ->
// would re-write the sentinel with a fresh timestamp, making it impossible to tell
// "session cleared on shutdown" from "session survived" after a real restart. The
// write now happens ONLY via the explicit `session/write-sentinel` message handler
// below, so a post-restart read observes the true cleared/survived state.
try {
  chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  console.log('[session] setAccessLevel(TRUSTED_CONTEXTS) requested (no sentinel written on wake)');
} catch (err) {
  console.error('[session] storage.session unavailable:', err);
}

const SESSION_SENTINEL_KEY = 'session-sentinel';

async function writeSessionSentinel() {
  const writtenAt = Date.now();
  await chrome.storage.session.set({
    [SESSION_SENTINEL_KEY]: {
      writtenAt,
      note: 'check-3: should be ABSENT after a real cold restart',
    },
  });
  return writtenAt;
}

async function readSessionSentinel() {
  const got = await chrome.storage.session.get(SESSION_SENTINEL_KEY);
  const value = got[SESSION_SENTINEL_KEY] ?? null;
  const present = Boolean(value);
  const deltaSec = present ? Math.round((Date.now() - value.writtenAt) / 1000) : null;
  return { present, value, deltaSec };
}

// --- canonicalizer + null/opaque-origin guard (§Sender-URL Binding) ---
// Mirrors the handler's response to a null-canonicalizing URL: opaque origins
// (about:blank, data:) and non-http(s) schemes canonicalize to null and MUST be
// hard-rejected with no write — NOT silently keyed under "undefined".
function canonicalizeUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new self.URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // about:blank / data: never parse to an http(s) URL, so they're already null
  // above; this is the belt-and-suspenders origin check.
  if (u.origin === 'null') return null;
  u.hash = '';
  return u.toString();
}

function ok(data) {
  return { ok: true, value: data };
}
function err(code) {
  return { ok: false, error: code };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type;

  // Provenance logging — the load-bearing fields for check 2.
  console.log('[sender]', type, {
    'sender.url': sender.url,
    'sender.frameId': sender.frameId,
    'sender.tab?.url': sender.tab ? sender.tab.url : undefined,
    'sender.tab?.id': sender.tab ? sender.tab.id : undefined,
    'sender.id === runtime.id': sender.id === chrome.runtime.id,
  });

  if (type === 'position/get') {
    // CS-typed: URL derives from sender.url, NEVER the payload.
    void (async () => {
      const canonical = canonicalizeUrl(sender.url);
      if (canonical === null) {
        console.log('[guard] REJECT position/get — null/opaque-origin sender.url:', sender.url);
        sendResponse(err('invalid-url'));
        return;
      }
      const record = await idbGet(`position:${canonical}`);
      sendResponse(ok({ canonical, frameId: sender.frameId, senderUrl: sender.url, record }));
    })();
    return true; // async sendResponse
  }

  if (type === 'position/list') {
    // Popup-typed: returns ALL records (the inverse composability check).
    void (async () => {
      const all = await idbGetAll();
      sendResponse(ok(all));
    })();
    return true;
  }

  if (type === 'session/write-sentinel') {
    // The ONLY place the check-3 sentinel is written. Triggered explicitly from the
    // popup so a manual quit+relaunch can observe whether session survives — never on
    // a bare SW wake (which would re-stamp a fresh timestamp and mask the verdict).
    void (async () => {
      try {
        const writtenAt = await writeSessionSentinel();
        console.log('[session] check-3 sentinel WRITTEN via session/write-sentinel:', writtenAt);
        sendResponse(ok({ writtenAt }));
      } catch (e) {
        sendResponse(err(String(e)));
      }
    })();
    return true;
  }

  if (type === 'session/read-sentinel') {
    // Read-only. Does NOT write. After a real cold restart this MUST report absent.
    void (async () => {
      try {
        const result = await readSessionSentinel();
        console.log('[session] check-3 sentinel READ via session/read-sentinel:', result);
        sendResponse(ok(result));
      } catch (e) {
        sendResponse(err(String(e)));
      }
    })();
    return true;
  }

  if (type === 'check2/sender-probe') {
    // Lightweight provenance echo for the automated check-2 assertions; returns
    // the raw sender fields so the test can assert sender.url == page URL.
    const probe = {
      senderUrl: sender.url,
      frameId: sender.frameId,
      tabUrl: sender.tab ? sender.tab.url : undefined,
      sameExtension: sender.id === chrome.runtime.id,
      canonical: canonicalizeUrl(sender.url),
    };
    // Stash the latest probe so Playwright can read it deterministically via
    // serviceWorker.evaluate (the content script is in the isolated world, out
    // of page.evaluate's reach).
    chrome.storage.session.set({ 'last-sender-probe': probe }).catch(() => {});
    sendResponse(ok(probe));
    return true;
  }

  return false;
});

console.log('[idb] background.js loaded — DB:', DB_NAME, 'store:', STORE);
