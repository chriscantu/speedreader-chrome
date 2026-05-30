/**
 * Top-level synchronous wiring for the welcome-page install trigger.
 *
 * Importing this module is the install step — it registers a
 * `chrome.runtime.onInstalled` listener at module load. Mirrors the
 * `commands/register.ts` and `context-menu/register.ts` patterns: each
 * SW side-effect module owns its own listener; Chrome dispatches the
 * `onInstalled` event to every registered listener, so this does NOT
 * collide with the context-menu module's own `onInstalled` registration.
 *
 * MV3 invariant: this file MUST be imported synchronously from the SW
 * entry (`src/chrome/background/index.ts`) so the listener is registered
 * before any `await` on every SW wake. A listener registered inside an
 * async callback after the first `await` is invisible to Chrome on
 * subsequent wakes (per `2026-05-22-sw-lifecycle-activation.md`
 * §"Listener Registration Discipline").
 *
 * Behavior:
 *  - `details.reason === 'install'` → open `chrome-extension://<id>/welcome.html`
 *    via `chrome.tabs.create`. Fire-and-forget — failure is swallowed
 *    (the extension still works without the onboarding tab).
 *  - All other reasons (`update`, `chrome_update`, `shared_module_update`)
 *    no-op. The full `details.reason` matrix is owned by the sw-lifecycle
 *    spec; this module pins only the positive case per spec line 86.
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md §"Install Trigger".
 */

const LOG_PREFIX = '[SpeedReader]';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  const url = chrome.runtime.getURL('welcome.html');
  // Fire-and-forget. Promise rejection (extension disabled, browser closing)
  // is swallowed via `.catch` rather than `void` so the error surfaces in
  // SW console without breaking other onInstalled listeners.
  chrome.tabs.create({ url }).catch((err) => {
    console.error(`${LOG_PREFIX} welcome: tabs.create failed`, err);
  });
});
