// D10 reproducer — fired by Ctrl+Shift+Y (Mac: MacCtrl+Shift+Y).
// Asserts chrome.scripting.executeScript succeeds on the active tab
// without host_permissions, using only activeTab + the commands gesture.

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== '_toggle_reader') return;
  if (!tab?.id) {
    console.error('[D10] FAIL: no active tab on command:', { command, tab });
    return;
  }
  const url = tab.url ?? '(unknown — activeTab pre-grant)';
  console.log('[D10] command fired:', { command, tabId: tab.id, url });

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        href: location.href,
        title: document.title,
        bodyTextSample: document.body?.innerText?.slice(0, 40) ?? null,
      }),
    });
    console.log('[D10] PASS: executeScript succeeded:', result.result);
    chrome.action?.setBadgeText?.({ text: 'OK', tabId: tab.id }).catch(() => {});
  } catch (err) {
    console.error('[D10] FAIL: executeScript rejected:', err);
    chrome.action?.setBadgeText?.({ text: 'FAIL', tabId: tab.id }).catch(() => {});
  }
});

console.log('[D10] background.js loaded — press Ctrl+Shift+Y on a non-restricted page.');
