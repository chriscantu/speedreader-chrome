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

// --- check 5: chrome.storage.local + setAccessLevel('TRUSTED_CONTEXTS') ---
//
// The backend-pivot gate. The cheaper candidate the spec must rule in or out:
// positions already live in chrome.storage.local (durable, no migration). IF
// setAccessLevel('TRUSTED_CONTEXTS') actually hides the local area from content
// scripts, this dominates extension-origin IDB (durable AND CS-isolated, zero
// migration). We must EMPIRICALLY confirm the isolation claim, capture the exact
// CS-side failure mode, and learn whether the CS also loses WRITE.
//
// Sequence: write the sentinel to local FIRST (so a regression where setAccessLevel
// also blocks the SW would surface), THEN restrict access. The CS probes only after
// `check5/ready` resolves (which awaits the setAccessLevel promise) so the test is
// not racing the boot-time restriction.
const LOCAL_SENTINEL_KEY = 'local-position-sentinel';
const LOCAL_SENTINEL_VALUE = {
  note: 'CS must NOT read this after setAccessLevel',
  source: 'sw-local-sentinel',
  wordIndex: 7,
};

// A promise that resolves once the local sentinel is written and the access level
// has been (attempted to be) set. `check5Ready` carries the empirical facts the
// test asserts: did setAccessLevel exist, did it succeed, what lastError (if any).
const check5Ready = (async () => {
  const facts = {
    setAccessLevelIsFunction: typeof chrome.storage.local.setAccessLevel === 'function',
    setAccessLevelCalled: false,
    setAccessLevelOk: false,
    setAccessLevelError: null,
    lastError: null,
    userAgent: self.navigator ? self.navigator.userAgent : null,
  };
  try {
    await chrome.storage.local.set({ [LOCAL_SENTINEL_KEY]: LOCAL_SENTINEL_VALUE });
    console.log('[local] check-5 sentinel written to chrome.storage.local ->', LOCAL_SENTINEL_KEY);
  } catch (e) {
    console.error('[local] FAIL: SW could not write local sentinel:', e);
    facts.setAccessLevelError = `sw-write-failed: ${String(e)}`;
    return facts;
  }
  if (!facts.setAccessLevelIsFunction) {
    console.error('[local] chrome.storage.local.setAccessLevel is NOT a function on this Chrome');
    facts.setAccessLevelError = 'not-a-function';
    return facts;
  }
  try {
    facts.setAccessLevelCalled = true;
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    if (chrome.runtime.lastError) {
      facts.lastError = chrome.runtime.lastError.message;
      console.error('[local] setAccessLevel lastError:', facts.lastError);
    } else {
      facts.setAccessLevelOk = true;
      console.log('[local] setAccessLevel(TRUSTED_CONTEXTS) on LOCAL succeeded');
    }
  } catch (e) {
    facts.setAccessLevelError = String(e);
    console.error('[local] setAccessLevel(TRUSTED_CONTEXTS) on LOCAL threw:', e);
  }
  // Park the facts in chrome.storage.session (a trusted area) so Playwright can read
  // them deterministically via serviceWorker.evaluate. A SW cannot receive its own
  // runtime.sendMessage, so the C5a assertion reads this stash, not a self-send RPC.
  try {
    await chrome.storage.session.set({ 'check5-facts': facts });
  } catch {
    /* session set is best-effort for the test read-back */
  }
  return facts;
})();

async function readLocalSentinel() {
  // Trusted-context (SW/popup) read. MUST still see the sentinel after the
  // restriction — TRUSTED_CONTEXTS includes the SW and the popup.
  const got = await chrome.storage.local.get(LOCAL_SENTINEL_KEY);
  return {
    value: got[LOCAL_SENTINEL_KEY] ?? null,
    present: Boolean(got[LOCAL_SENTINEL_KEY]),
  };
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

  if (type === 'check5/ready') {
    // The CS calls this BEFORE probing local, so its probe runs only after the SW
    // has written the sentinel and (attempted to) restrict the access level. Returns
    // the empirical setAccessLevel facts so the CS/test never races the restriction.
    void (async () => {
      const facts = await check5Ready;
      sendResponse(ok(facts));
    })();
    return true;
  }

  if (type === 'check5/read-sentinel') {
    // Trusted-context read (popup/SW). After the restriction, this MUST still return
    // the sentinel — that's the half of the verdict proving trusted contexts keep access.
    void (async () => {
      await check5Ready;
      const result = await readLocalSentinel();
      console.log('[local] check-5 trusted-context read:', JSON.stringify(result));
      sendResponse(ok(result));
    })();
    return true;
  }

  if (type === 'check5/cs-result') {
    // The CS stashes its OWN probe results here (read attempt, get(null) enumeration,
    // write attempt). The CS lives in the page's isolated world, out of page.evaluate's
    // reach, so it relays via this RPC and the SW parks it in chrome.storage.session
    // (a TRUSTED area, distinct from the restricted `local`) for the test to poll.
    void (async () => {
      const payload = (msg && msg.payload) || {};
      const stamped = { ...payload, senderUrl: sender.url, frameId: sender.frameId };
      await chrome.storage.session.set({ 'last-check5-cs-result': stamped });
      console.log('[local] check-5 CS result stashed:', JSON.stringify(stamped));
      sendResponse(ok(true));
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
