/**
 * Position RPC handlers (#196). Six message types: three content-script-bound,
 * three popup-only. See
 * `docs/superpowers/specs/2026-06-11-position-store-service-worker.md`.
 *
 * SECURITY INVARIANT — sender.url binding (spec §Sender-URL Binding):
 *   A content-script position RPC derives its URL from `sender.url`, NEVER from
 *   the message payload. CS wire shapes carry no `url` field; this handler
 *   never reads one for CS types. A hostile/compromised CS cannot ask for
 *   another origin's position — its reach is structurally pinned to the page it
 *   already runs on.
 *
 *   LOAD-BEARING GATE DEPENDENCY (do not refactor away): the `sender.url`
 *   guarantee depends on two checks in `messaging/on-message.ts` running BEFORE
 *   this handler — (a) the foreign-extension rejection
 *   (`sender.id !== chrome.runtime.id`), without which `sender.url` could be
 *   `undefined` for a cross-extension sender, and (b) the CS sender-shape gate
 *   (`sender.tab?.id !== undefined && sender.frameId === 0`), which keeps
 *   popup/options senders out of CS-typed handlers. Removing either silently
 *   breaks the URL-binding invariant.
 *
 * NULL/OPAQUE-ORIGIN REJECT (spec §Sender-URL Binding): when `sender.url` is
 * absent or canonicalizes to `null` (opaque origin like `about:blank`/`data:`,
 * or a disallowed scheme), the CS handlers return an error and perform ZERO
 * store access — guarding the `"position:undefined"`-key poisoning path.
 */

import type { ReadingPositionStore } from '../../../core/storage/reading-position';
import { canonicalizeUrl } from '../../../core/url/canonicalize';
import { validatePositionSet, validatePositionDelete } from '../../../core/messaging/validate';
import {
  CS_POSITION_TYPES,
  POPUP_POSITION_TYPES,
  type PositionMessageType,
} from '../../../core/messaging/types';
import type { OnMessageError } from '../messaging/on-message';
import { positionStore } from './store';

export type PositionResponse = { ok: true; data: unknown } | { ok: false; error: OnMessageError };

export interface PositionHandlerDeps {
  store: ReadingPositionStore;
}

const defaultDeps: PositionHandlerDeps = { store: positionStore };

const ALL_POSITION_TYPES: ReadonlySet<string> = new Set<string>([
  ...CS_POSITION_TYPES,
  ...POPUP_POSITION_TYPES,
]);

function isPositionType(type: string): type is PositionMessageType {
  return ALL_POSITION_TYPES.has(type);
}

function err(sendResponse: (r: PositionResponse) => void): void {
  sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
}

/**
 * Dispatch a position message. Returns `true` when `msg.type` is one of the six
 * position types (and was handled), `false` otherwise so the caller can fall
 * through to its other routes.
 *
 * Each handler runs inside a `void (async () => { ...; sendResponse(...) })()`
 * so the synchronous return value stays available for the caller's listener
 * contract (the listener must return `true` synchronously to keep
 * `sendResponse` alive; an async handler would drop it).
 */
export function handlePosition(
  msg: { type: string } & Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: PositionResponse) => void,
  deps: PositionHandlerDeps = defaultDeps,
): boolean {
  if (!isPositionType(msg.type)) return false;
  const { store } = deps;

  switch (msg.type) {
    case 'position/get': {
      const url = csUrlOrReject(sender, sendResponse);
      if (url === null) return true;
      void (async () => {
        const pos = await store.read(url);
        sendResponse({ ok: true, data: pos ?? null });
      })();
      return true;
    }

    case 'position/set': {
      const url = csUrlOrReject(sender, sendResponse);
      if (url === null) return true;
      const payload = validatePositionSet(msg);
      if (payload === null) {
        err(sendResponse);
        return true;
      }
      void (async () => {
        await store.write(url, { wordIndex: payload.wordIndex, totalWords: payload.totalWords });
        sendResponse({ ok: true, data: undefined });
      })();
      return true;
    }

    case 'position/clear': {
      const url = csUrlOrReject(sender, sendResponse);
      if (url === null) return true;
      void (async () => {
        await store.clear(url);
        sendResponse({ ok: true, data: undefined });
      })();
      return true;
    }

    case 'position/list': {
      void (async () => {
        const entries = await store.list();
        sendResponse({ ok: true, data: entries });
      })();
      return true;
    }

    case 'position/delete': {
      const payload = validatePositionDelete(msg);
      if (payload === null) {
        err(sendResponse);
        return true;
      }
      void (async () => {
        await store.clear(payload.url);
        sendResponse({ ok: true, data: undefined });
      })();
      return true;
    }

    case 'position/clear-all': {
      void (async () => {
        await store.clearAll();
        sendResponse({ ok: true, data: undefined });
      })();
      return true;
    }
  }
}

/**
 * Resolve the canonical URL for a CS-bound position RPC from `sender.url`.
 * Returns the canonical URL string, or `null` after sending the reject
 * response (caller returns immediately, performing NO store access). `null`
 * means: absent `sender.url`, opaque origin, or disallowed scheme.
 */
function csUrlOrReject(
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: PositionResponse) => void,
): string | null {
  const raw = sender.url;
  if (typeof raw !== 'string') {
    err(sendResponse);
    return null;
  }
  const canonical = canonicalizeUrl(raw);
  if (canonical === null) {
    err(sendResponse);
    return null;
  }
  return canonical;
}
