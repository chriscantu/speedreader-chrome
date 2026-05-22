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

// T2 path — chrome.action.onClicked is a known-good gesture source for activeTab.
// Same executeScript chain as the commands path, but triggerable from Playwright.
// Used by the automated suite at tests/d10.spec.ts.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    console.error('[D10] FAIL (action): no active tab on click:', { tab });
    return;
  }
  console.log('[D10] action fired:', { tabId: tab.id, url: tab.url });
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ href: location.href, title: document.title }),
    });
    console.log('[D10] PASS (action): executeScript succeeded:', result.result);
  } catch (err) {
    console.error('[D10] FAIL (action): executeScript rejected:', err);
  }
});

console.log('[D10] background.js loaded — press Ctrl+Shift+Y on a non-restricted page, OR click the toolbar action.');
