/**
 * Activation dispatch funnel — the single seam between activation sources
 * (commands hotkey, context menu, popup) and the read-session wire.
 *
 * Per the SW-lifecycle ADR (`docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`)
 * and spec (`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`), every
 * source MUST normalize to an `ActivationIntent` and pass through this
 * function. The core flow is one branchless path:
 *
 *   1. tab URL lookup
 *   2. restricted-URL guard (`src/core/restricted.ts`)
 *   3. content-script injection via `chrome.scripting.executeScript`
 *   4. handoff to the CS via `chrome.tabs.sendMessage({type: 'activate-reader'})`
 *
 * `intent.source` is consulted ONLY for payload normalization (extracting
 * `selectionText` from the `contextMenu` variant). The four-step flow is
 * source-blind.
 *
 * Errors from any step are converted to `Result.err` — exceptions never
 * leak across the funnel boundary. The Port handoff itself is owned by
 * the messaging-contract spec (`docs/superpowers/specs/2026-05-08-messaging-contract.md`);
 * this funnel only hands off the one-shot `activate-reader` RPC. The
 * `rsvp-session` Port is opened separately by the popup or the CS per
 * that spec.
 */

/// <reference types="@crxjs/vite-plugin/client" />

import { isRestricted } from '../../../core/restricted';
import type { ActivationError, ActivationIntent, Result } from './types';

// `?script` is the crxjs vite-plugin pattern for referencing a script entry
// from another extension surface. The default export is the filename of the
// emitted loader (e.g., `assets/index.ts-<hash>.js`) — i.e., the path that
// `chrome.scripting.executeScript({ files })` resolves against the BUILT
// extension. At dev / build time crxjs registers the entry with Rollup and
// emits the corresponding chunk; the `.ts` source is never referenced at
// runtime. See `node_modules/@crxjs/vite-plugin/client.d.ts`.
import CONTENT_SCRIPT_FILE from '../../content/index.ts?script';
export { CONTENT_SCRIPT_FILE };

/**
 * Payload sent to the content script on activation. Mirrors the
 * `activate-reader` one-shot RPC added by the SW-lifecycle spec to the
 * messaging-contract `Msg` union.
 */
interface ActivateReaderMessage {
  type: 'activate-reader';
  scope: 'selection' | 'full';
}

/**
 * Normalize a source-specific intent into the scope payload the CS expects.
 * This is the ONLY place `intent.source` is inspected — the rest of the
 * funnel is source-blind.
 */
function intentToActivatePayload(intent: ActivationIntent): ActivateReaderMessage {
  if (intent.source === 'contextMenu' && intent.selectionText !== undefined) {
    return { type: 'activate-reader', scope: 'selection' };
  }
  return { type: 'activate-reader', scope: 'full' };
}

/**
 * Dispatch an activation intent. Returns a `Result` — never throws.
 */
export async function dispatchActivation(
  intent: ActivationIntent,
): Promise<Result<void, ActivationError>> {
  // 1. Resolve the tab URL. tabs.get can reject (closed tab, race).
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(intent.tabId);
  } catch (details) {
    return { ok: false, error: { kind: 'tab-unavailable', tabId: intent.tabId, details } };
  }

  const url = tab.url ?? '';

  // 2. Restricted-URL guard. `chrome.runtime.id` is the call-site lookup
  //    that keeps `isRestricted` platform-agnostic.
  if (isRestricted(url, chrome.runtime.id)) {
    return { ok: false, error: { kind: 'restricted-page', url } };
  }

  // 3. Inject the content script. Convert rejections (TOCTOU restricted
  //    URLs, etc.) to a typed `inject-failed` error.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: intent.tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch (details) {
    return { ok: false, error: { kind: 'inject-failed', tabId: intent.tabId, details } };
  }

  // 4. Hand off to the CS via the `activate-reader` one-shot RPC. The
  //    `rsvp-session` Port is opened separately by the popup / CS per
  //    the messaging-contract spec.
  const payload = intentToActivatePayload(intent);
  try {
    await chrome.tabs.sendMessage(intent.tabId, payload);
  } catch (details) {
    return { ok: false, error: { kind: 'handoff-failed', tabId: intent.tabId, details } };
  }

  return { ok: true, data: undefined };
}
