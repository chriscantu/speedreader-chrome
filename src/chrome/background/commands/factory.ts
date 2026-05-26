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
  // `addListener` is sync — MV3 invariant preserved. Errors are
  // swallowed inside `handleCommand` so an unexpected rejection cannot
  // become an unhandled-promise event in the SW. The returned promise
  // has no Chrome-side protocol effect (unlike `runtime.onMessage`);
  // the arrow is captured by the test stub so `await _listener(...)`
  // resolves once `handleCommand` settles.
  chrome.commands.onCommand.addListener((command, tab) => handleCommand(deps, command, tab));
}

async function handleCommand(
  deps: CommandsDeps,
  command: string,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  // Defense against future binding additions — only react to the one
  // command this module owns. Intentional silent no-op at runtime: a
  // future binding added to the manifest but not wired here should fail
  // loudly at the test layer (see "ignores unknown commands"), not in
  // production where every keystroke would spam the SW log.
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
