// #196 reproducer — popup (runs under chrome-extension://<id>, same origin as SW).
//
// Check 1 inverse composability: position/list via RPC returns the SW-written
// sentinel, confirming popup + SW share the chrome-extension://<id> IDB namespace.
// This is the OTHER direction the spec requires: CS sees nothing, popup sees all.

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
  const out = document.getElementById('out');
  const verdict = document.getElementById('verdict');

  const resp = await send({ type: 'position/list' });
  out.textContent = JSON.stringify(resp, null, 2);

  const records = resp && resp.ok ? resp.value : [];
  const sawSentinel =
    Array.isArray(records) &&
    records.some((r) => r && r.position && r.position.source === 'sw-sentinel');

  if (sawSentinel) {
    verdict.innerHTML =
      '<span class="pass">PASS — popup sees the SW sentinel (shared namespace)</span>';
    console.log('[popup] PASS: position/list returned SW sentinel');
  } else {
    verdict.innerHTML = '<span class="fail">FAIL — popup did NOT see the SW sentinel</span>';
    console.log('[popup] FAIL: position/list missing SW sentinel:', JSON.stringify(resp));
  }
}

run();
