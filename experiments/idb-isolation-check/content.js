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
