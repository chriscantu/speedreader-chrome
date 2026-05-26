/**
 * `chrome.contextMenus.onClicked` handler — translates a click event
 * into either a `dispatchActivation` call (preset speed clicks) or a
 * `saveSettings` write (toggle clicks) or an `openOptionsPage`
 * navigation (Custom… click).
 *
 * Frame provenance (spec §"Frame Provenance"): if `info.frameId !== 0`
 * the click came from inside an embedded frame. The selection lives
 * in the iframe but the CS re-reads `getSelection()` in the top
 * frame, so silent fallback to full-article would be confusing (and a
 * hostile-iframe vector for unintended parent-page extraction). We
 * refuse activation at the listener seam and surface a one-line
 * status to the user.
 *
 * Toggle persistence (spec §"Toggle Persistence Semantics", OQ-1 →
 * RESOLVED): the `Show context line` / `Start from word 1` toggles are
 * persistent settings writes. The submenu rebroadcast (via
 * `subscribeSettings` → `ensureContextMenu`) refreshes the visible
 * `checked` state within one debounce window plus a render tick.
 *
 * Exhaustive switch: the `default` arm contains a `never` assignment
 * so any new `CtxMenuItemId` literal added to `factory.ts` without a
 * corresponding `case` here fails the type check.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   §"Submenu Structure", §"Toggle Persistence Semantics",
 *   §"Frame Provenance".
 */

import type { CtxMenuItemId } from './factory';
import { dispatchActivation } from '../activation/dispatch';
import { saveSettings, loadSettings } from '../../settings/storage';

/**
 * Numeric WPM presets keyed by stable menu-item ID. The 250 default
 * lives in `DEFAULT_SETTINGS`, not here — `lastUsed` and `custom`
 * follow their own paths below.
 */
const PRESETS: Partial<Record<CtxMenuItemId, number>> = {
  'speedreader.ctx.preset.300.v1': 300,
  'speedreader.ctx.preset.500.v1': 500,
};

const LOG_PREFIX = '[SpeedReader]';

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  // Frame-provenance gate. `info.frameId === 0` is the top frame; any
  // other value is an iframe selection (spec AC #18).
  if (info.frameId !== 0) {
    if (tab?.id !== undefined) {
      // One-shot toast intent. The CS overlay surface that consumes
      // this lands with #19; until then the message is benign (no CS
      // is present to receive it on an unactivated page). The `.catch`
      // swallows the "Receiving end does not exist" rejection that
      // arises pre-#19.
      void chrome.tabs
        .sendMessage(tab.id, {
          type: 'ctx-frame-blocked',
          message: 'Selection inside embedded frame; right-click the page directly',
        })
        .catch(() => {});
    }
    return;
  }

  if (tab?.id === undefined) {
    console.warn(`${LOG_PREFIX} contextMenu: no tab id available, ignoring click`);
    return;
  }

  const id = info.menuItemId as CtxMenuItemId;

  switch (id) {
    case 'speedreader.ctx.preset.300.v1':
    case 'speedreader.ctx.preset.500.v1': {
      const wpm = PRESETS[id];
      if (wpm === undefined) return; // unreachable; satisfies the lookup type
      // Persist lastUsedWpm so the submenu's `lastUsed` label and any
      // future right-click show the user's most recent choice. The
      // 300ms debounce in `saveSettings` is sized for this rate
      // (one write per click, max).
      void saveSettings({ lastUsedWpm: wpm });
      await dispatchActivation({
        source: 'contextMenu',
        tabId: tab.id,
        selectionText: info.selectionText,
        menuItemId: id,
        overrides: { wpm },
      });
      return;
    }
    case 'speedreader.ctx.lastUsed.v1': {
      const settings = await loadSettings();
      await dispatchActivation({
        source: 'contextMenu',
        tabId: tab.id,
        selectionText: info.selectionText,
        menuItemId: id,
        overrides: { wpm: settings.lastUsedWpm },
      });
      return;
    }
    case 'speedreader.ctx.preset.custom.v1':
      // Navigation, not activation (spec §"Custom… behavior"). The
      // options page exposes the full WPM slider; a context-menu
      // "type a number" UX is out of scope for M1.
      chrome.runtime.openOptionsPage();
      return;
    case 'speedreader.ctx.toggle.showContext.v1':
      // `info.checked` is the NEW checked state Chrome reports after
      // the user's click — store it directly.
      void saveSettings({ contextLine: info.checked === true });
      return;
    case 'speedreader.ctx.toggle.startFromWord1.v1':
      void saveSettings({ startFromWordOne: info.checked === true });
      return;
    case 'speedreader.ctx.parent.v1':
    case 'speedreader.ctx.separator.v1':
      // Parent clicks don't fire when children exist; separator items
      // never dispatch click events. Both `case`s exist purely to
      // keep the switch exhaustive — see the `never` assertion below.
      return;
    default: {
      // Exhaustiveness check: any new CtxMenuItemId added without a
      // matching case above becomes a TS error here.
      const _exhaust: never = id;
      void _exhaust;
      return;
    }
  }
}
