/**
 * `chrome.commands.onCommand` listener — wires the global hotkey
 * (`_toggle_reader`, default `Ctrl+Shift+Y` / `MacCtrl+Shift+Y`) into
 * the activation-dispatch funnel.
 *
 * Listener registration is top-level synchronous — the MV3 invariant.
 * Any await before `addListener` would make the listener invisible to
 * Chrome on subsequent SW wakes.
 *
 * Per the SW-lifecycle ADR (§"Restricted-URL Guard"), this path is
 * silent on restricted pages: the popup is the only surface that
 * renders a user-visible banner. Hotkey misses log via
 * `console.warn('[SpeedReader] …')` and no-op.
 *
 * The `tab` argument is provided by Chrome on the gesture path
 * (Chrome 121+). When absent (older Chrome, devtools, edge cases),
 * fall back to `chrome.tabs.query({active, lastFocusedWindow})`.
 *
 * See:
 * - issue #34
 * - `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * - `docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`
 */

import type { ActivationError, ActivationIntent, Result } from '../activation/types';

const TARGET_COMMAND = '_toggle_reader';
const LOG_PREFIX = '[SpeedReader]';

type Dispatch = (intent: ActivationIntent) => Promise<Result<void, ActivationError>>;

interface CommandsDeps {
  dispatch: Dispatch;
}

async function resolveTabId(tab: chrome.tabs.Tab | undefined): Promise<number | undefined> {
  if (typeof tab?.id === 'number') return tab.id;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = tabs[0]?.id;
  return typeof id === 'number' ? id : undefined;
}

/**
 * Factory so tests can inject a mock dispatch without booting the funnel.
 * The default export below calls it with the real `dispatchActivation`
 * at module top-level — the addListener call MUST run synchronously on
 * every SW wake.
 */
export function registerCommands(deps: CommandsDeps): void {
  // The listener body is async, but `addListener` itself is sync —
  // the MV3 invariant is preserved. Returning the promise from a
  // `chrome.commands.onCommand` callback has no protocol effect
  // (unlike `runtime.onMessage`), so we hand it back to make the
  // listener awaitable in tests. Errors are swallowed inside so an
  // unexpected rejection cannot become an unhandled-promise event
  // in the SW.
  chrome.commands.onCommand.addListener((command, tab) => handleCommand(deps, command, tab));
}

async function handleCommand(
  deps: CommandsDeps,
  command: string,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  // Defense against future binding additions — only react to the one
  // command this module owns.
  if (command !== TARGET_COMMAND) return;

  try {
    const tabId = await resolveTabId(tab);
    if (tabId === undefined) {
      console.warn(`${LOG_PREFIX} commands: no active tab resolved for ${command}`);
      return;
    }

    const intent: ActivationIntent = { source: 'command', tabId };
    const result = await deps.dispatch(intent);
    if (!result.ok) {
      console.warn(`${LOG_PREFIX} commands: dispatch failed (${result.error.kind})`, result.error);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} commands: unexpected error`, err);
  }
}
