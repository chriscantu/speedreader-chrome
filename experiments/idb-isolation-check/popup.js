// #196 reproducer — popup (runs under chrome-extension://<id>, same origin as SW).
//
// Check 1 inverse composability: position/list via RPC returns the SW-written
// sentinel, confirming popup + SW share the chrome-extension://<id> IDB namespace.
// This is the OTHER direction the spec requires: CS sees nothing, popup sees all.
//
// Check 3 (session restart survival): two explicit buttons drive the session sentinel
// — Write (the ONLY write path) and Read (read-only verdict). Opening this popup wakes
// the SW but no longer writes the sentinel, so a fresh-load Read reads ABSENT until
// Write is clicked. That's what makes the post-restart verdict trustworthy.

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

// --- Check 3: explicit session-sentinel write / read ---

function fmtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return String(ms);
  }
}

// Render a single-class verdict line via textContent (no innerHTML — keeps the
// SW-controlled numeric values off any markup-parsing path).
function setVerdict(el, cls, text) {
  el.textContent = '';
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text;
  el.appendChild(span);
}

async function writeSession() {
  const v = document.getElementById('session-verdict');
  const out = document.getElementById('session-out');
  const resp = await send({ type: 'session/write-sentinel' });
  out.textContent = JSON.stringify(resp, null, 2);
  if (resp && resp.ok) {
    const writtenAt = resp.value.writtenAt;
    setVerdict(v, 'pass', `Written — writtenAt ${fmtTime(writtenAt)} (${writtenAt})`);
    console.log('[popup][check3] session sentinel written:', writtenAt);
  } else {
    setVerdict(v, 'fail', 'Write FAILED — see payload');
    console.log('[popup][check3] write failed:', JSON.stringify(resp));
  }
}

async function readSession() {
  const v = document.getElementById('session-verdict');
  const out = document.getElementById('session-out');
  const resp = await send({ type: 'session/read-sentinel' });
  out.textContent = JSON.stringify(resp, null, 2);

  const result = resp && resp.ok ? resp.value : null;
  if (!result || !result.present) {
    setVerdict(v, 'pass', 'PASS — session was cleared (did NOT survive restart)');
    console.log('[popup][check3] PASS: session sentinel ABSENT');
    return;
  }

  const { value, deltaSec } = result;
  const writtenAt = value && value.writtenAt;
  v.textContent = '';
  const fail = document.createElement('span');
  fail.className = 'fail';
  fail.textContent = `FAIL/SURVIVED — sentinel present, writtenAt ${fmtTime(writtenAt)}, delta ${deltaSec}s`;
  const note = document.createElement('span');
  note.className = 'muted';
  note.textContent =
    'A LARGE delta spanning the quit = genuine survival. A small delta would mean the SW ' +
    're-wrote on wake — that should no longer happen now that auto-write is removed; if you ' +
    'see it, the methodology fix regressed.';
  v.append(fail, document.createElement('br'), note);
  console.log('[popup][check3] FAIL: session sentinel present, deltaSec=', deltaSec);
}

document.getElementById('write-session').addEventListener('click', writeSession);
document.getElementById('read-session').addEventListener('click', readSession);

// --- Check 5: trusted-context read of the restricted local sentinel ---
// The popup runs in a TRUSTED_CONTEXTS context (alongside the SW), so even after the
// SW restricts `local`, the popup MUST still read the sentinel. This is the second
// half of the C5 verdict — CS blocked, trusted context unaffected.
async function readLocal() {
  const v = document.getElementById('local-verdict');
  const out = document.getElementById('local-out');
  const resp = await send({ type: 'check5/read-sentinel' });
  out.textContent = JSON.stringify(resp, null, 2);
  const result = resp && resp.ok ? resp.value : null;
  if (result && result.present && result.value && result.value.source === 'sw-local-sentinel') {
    setVerdict(v, 'pass', 'PASS — popup (trusted context) still reads the local sentinel');
    console.log('[popup][check5] PASS: trusted-context read returned the sentinel');
  } else {
    setVerdict(v, 'fail', 'FAIL — popup did NOT read the local sentinel');
    console.log('[popup][check5] FAIL: trusted-context read missing sentinel:', JSON.stringify(resp));
  }
}

readLocal();
