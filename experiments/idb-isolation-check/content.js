// #196 reproducer — content script (runs in the HOST PAGE's origin).
//
// Check 1 (origin isolation): open 'speedreader-positions' from the page origin.
// Objective PASS = onupgradeneeded fires with event.oldVersion === 0 (the DB does
// NOT exist in the CS origin — the SW's chrome-extension://<id> DB is invisible
// here) AND the CS reads no sentinel record. We deliberately do NOT rely on
// indexedDB.databases() emptiness (spec: oldVersion===0 is the unambiguous check).
//
// Check 2 (sender.url): send position/get + check2/sender-probe to the SW; the SW
// logs/echoes sender.url, sender.frameId, sender.tab?.url. A DECLARED content
// script gets sender.url populated WITHOUT the tabs permission.
//
// IDB is reached via window.indexedDB (the page-origin handle).

const DB_NAME = 'speedreader-positions';

function probePageOriginIdb() {
  return new Promise((resolve) => {
    let upgradeFired = false;
    let oldVersion = null;
    let sawSentinel = false;

    // Open WITHOUT a version so we never force-bump an existing page DB; a brand
    // new DB still fires onupgradeneeded with oldVersion === 0.
    const req = window.indexedDB.open(DB_NAME);

    req.onupgradeneeded = (event) => {
      upgradeFired = true;
      oldVersion = event.oldVersion;
      // Abort the implicit version-change transaction so we do NOT create a
      // lingering DB in the page origin (clean reproducer, no side effects).
      try {
        event.target.transaction.abort();
      } catch {
        /* ignore */
      }
    };

    req.onsuccess = () => {
      // Reached only if the DB already existed in this origin (upgrade not fired)
      // OR the abort path resolved success on some engines. Attempt a sentinel read.
      const db = req.result;
      try {
        if (db.objectStoreNames.contains('positions')) {
          const tx = db.transaction('positions', 'readonly');
          const r = tx.objectStore('positions').getAll();
          r.onsuccess = () => {
            sawSentinel = (r.result || []).some(
              (row) => row && row.value && row.value.source === 'sw-sentinel',
            );
            db.close();
            resolve({ upgradeFired, oldVersion, sawSentinel });
          };
          r.onerror = () => {
            db.close();
            resolve({ upgradeFired, oldVersion, sawSentinel });
          };
          return;
        }
      } catch {
        /* ignore */
      }
      db.close();
      resolve({ upgradeFired, oldVersion, sawSentinel });
    };

    req.onerror = () => resolve({ upgradeFired, oldVersion, sawSentinel, error: true });
    // onupgradeneeded + abort surfaces as onerror on some engines; treat the
    // captured oldVersion as authoritative regardless of which terminal fires.
    req.onblocked = () => resolve({ upgradeFired, oldVersion, sawSentinel, blocked: true });
  });
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ lastError: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp);
    });
  });
}

// --- check 5: probe chrome.storage.local from the content script after the SW has
// called setAccessLevel('TRUSTED_CONTEXTS'). Capture the EXACT failure mode for each
// operation — does it throw synchronously? reject? populate runtime.lastError? return
// {} / undefined? The spec needs to state precisely what a blocked CS observes.
//
// chrome.storage.local.get can fail two ways: a SYNCHRONOUS throw (method shape) or an
// ASYNC failure surfaced via chrome.runtime.lastError in the callback (the documented
// access-denied path). We capture both. We also try BOTH a keyed get and a get(null)
// enumeration, and a set() WRITE — the spec needs to know if the CS loses write too.
function probeLocalOp(invoke) {
  return new Promise((resolve) => {
    let result;
    try {
      result = invoke((cbValue) => {
        const lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
        resolve({ outcome: lastError ? 'lastError' : 'returned', lastError, value: cbValue });
      });
    } catch (e) {
      resolve({ outcome: 'sync-throw', error: String(e && e.message ? e.message : e) });
      return;
    }
    // If the API returned a promise (MV3 promise form), capture its settle behavior too.
    if (result && typeof result.then === 'function') {
      result
        .then((v) => {
          const lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
          resolve({ outcome: lastError ? 'lastError' : 'resolved', lastError, value: v });
        })
        .catch((e) =>
          resolve({ outcome: 'rejected', error: String(e && e.message ? e.message : e) }),
        );
    }
  });
}

async function probeLocalFromContent() {
  const SENTINEL_KEY = 'local-position-sentinel';

  // Gate on the SW having set the access level (await the ready facts).
  const ready = await send({ type: 'check5/ready' });

  // 1. keyed get — the headline read the spec's isolation claim is about.
  const keyedGet = await probeLocalOp((cb) => chrome.storage.local.get(SENTINEL_KEY, cb));
  // 2. get(null) — full enumeration; a blocked CS must NOT see the sentinel here either.
  const enumGet = await probeLocalOp((cb) => chrome.storage.local.get(null, cb));
  // 3. write attempt — does the restriction also strip the CS of WRITE?
  const writeAttempt = await probeLocalOp((cb) =>
    chrome.storage.local.set({ 'cs-write-probe': { from: 'content-script', ts: Date.now() } }, cb),
  );

  function sawSentinel(probe) {
    const v = probe && probe.value;
    if (!v || typeof v !== 'object') return false;
    const rec = v[SENTINEL_KEY];
    return Boolean(rec && rec.source === 'sw-local-sentinel');
  }

  const csResult = {
    ready: ready && ready.value ? ready.value : ready,
    keyedGet,
    enumGet,
    writeAttempt,
    sawSentinelKeyed: sawSentinel(keyedGet),
    sawSentinelEnum: sawSentinel(enumGet),
  };
  console.log('[content][check5] local probe (post-setAccessLevel):', JSON.stringify(csResult));
  await send({ type: 'check5/cs-result', payload: csResult });
}

// --- check 6: does the setAccessLevel('TRUSTED_CONTEXTS') restriction PERSIST while
// the SW is idle-evicted / stopped? ---
//
// Check 5 proved the restriction blocks this CS WHILE THE SW IS ALIVE. Check 6 asks
// the harder, security-load-bearing question: a CS injected during a prior activation
// stays alive in its tab's renderer after the SW is evicted (~30s idle). If the
// restriction were scoped to the SW's lifetime and lapsed when the SW stopped, this
// already-alive CS could enumerate chrome.storage.local (the user's cross-origin
// reading history) during the (usually long) evicted window. The Chrome docs do not
// state whether the restriction persists, so we MUST measure it.
//
// CRITICAL test-engineering constraint: when this probe runs the SW is STOPPED, so the
// check5/cs-result RPC relay is DEAD (and worse, calling chrome.runtime.sendMessage
// would WAKE the SW and invalidate the "SW stopped" precondition). So this probe:
//   1. surfaces its result through the PAGE DOM (a #check6-result node), which
//      page.evaluate in the main world CAN read (CS isolated world + page main world
//      share the DOM). It does NOT touch chrome.runtime at all.
//   2. runs on demand, in response to a `check6-probe` CustomEvent that Playwright
//      dispatches AFTER it has stopped the SW (DOM events propagate to both the
//      isolated-world and main-world `window` listeners).
//
// The same probeLocalOp() machinery as check 5 captures the EXACT failure mode
// (sync-throw / lastError / rejected / returned) for each of: keyed get, get(null)
// enumeration, and a set() write.

const CHECK6_RESULT_ID = 'check6-result';
const LOCAL_SENTINEL_KEY = 'local-position-sentinel';

function sawCheck6Sentinel(probe) {
  const v = probe && probe.value;
  if (!v || typeof v !== 'object') return false;
  const rec = v[LOCAL_SENTINEL_KEY];
  return Boolean(rec && rec.source === 'sw-local-sentinel');
}

// Write the probe outcome (or a phase marker) into a dedicated DOM node so the main
// world can read it back without any chrome.runtime round-trip. We stash the full JSON
// in data-outcome and a coarse data-status the test can wait on.
function writeCheck6Dom(status, payload) {
  let node = document.getElementById(CHECK6_RESULT_ID);
  if (!node) {
    node = document.createElement('div');
    node.id = CHECK6_RESULT_ID;
    node.style.display = 'none';
    // documentElement is always present even on minimal fixture pages.
    (document.body || document.documentElement).appendChild(node);
  }
  node.setAttribute('data-status', status);
  if (payload !== undefined) {
    node.setAttribute('data-outcome', JSON.stringify(payload));
  }
}

async function runCheck6Probe() {
  // Three direct chrome.storage.local ops — NO chrome.runtime.sendMessage (that would
  // wake the stopped SW). keyed get is the headline read; get(null) is full
  // enumeration; set is the write the spec also needs a verdict on.
  const keyedGet = await probeLocalOp((cb) => chrome.storage.local.get(LOCAL_SENTINEL_KEY, cb));
  const enumGet = await probeLocalOp((cb) => chrome.storage.local.get(null, cb));
  const writeAttempt = await probeLocalOp((cb) =>
    chrome.storage.local.set(
      { 'cs-write-probe-c6': { from: 'content-script', ts: Date.now() } },
      cb,
    ),
  );

  const result = {
    keyedGet,
    enumGet,
    writeAttempt,
    sawSentinelKeyed: sawCheck6Sentinel(keyedGet),
    sawSentinelEnum: sawCheck6Sentinel(enumGet),
    href: location.href,
  };
  console.log(
    '[content][check6] local probe (SW state controlled by harness):',
    JSON.stringify(result),
  );
  writeCheck6Dom('done', result);
}

// Register the on-demand probe listener at injection time. Playwright fires the event
// AFTER stopping (or while keeping alive, for the negative control) the SW.
window.addEventListener('check6-probe', () => {
  writeCheck6Dom('running');
  void runCheck6Probe();
});
// Signal readiness so the test can wait for the listener to be wired before firing.
writeCheck6Dom('ready');

async function run() {
  const idb = await probePageOriginIdb();
  console.log(
    '[content][check1] page-origin IDB probe:',
    JSON.stringify(idb),
    'href:',
    location.href,
  );

  const getResp = await send({ type: 'position/get' });
  console.log('[content][check2] position/get response:', JSON.stringify(getResp));

  const probeResp = await send({ type: 'check2/sender-probe' });
  console.log('[content][check2] sender-probe response:', JSON.stringify(probeResp));

  // Check 5 — local + setAccessLevel isolation (backend-pivot gate).
  await probeLocalFromContent();

  // NOTE: this content script runs in the ISOLATED world, so a window global set
  // here is NOT visible to Playwright's page.evaluate (main world). The two
  // read-back channels the automated suite uses instead:
  //   - console logs (captured via page.on('console')) for the [content] lines;
  //   - the SW echoing sender fields into chrome.storage.session under
  //     'last-sender-probe', read via serviceWorker.evaluate (deterministic).
  // The page-origin IDB fact is ALSO independently re-checked by Playwright in
  // the page MAIN world (same origin -> same IndexedDB namespace) so check 1 has
  // a read-back that doesn't depend on isolated-world console timing.
}

run();
