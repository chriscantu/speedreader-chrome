/**
 * Popup history client (#196).
 *
 * The popup is a trusted context (`chrome-extension://<id>`) and RETAINS direct
 * `chrome.storage.local` access even after `setAccessLevel`. It MUST NOT use it
 * for writes anyway: `delete` and `clear-all` mutate the shared LRU index, and
 * a trusted page writing directly would be a second writer racing the SW's
 * module-scope queue — reintroducing the cross-tab LRU divergence the
 * single-writer design exists to close. Every mutation (and, for one trust
 * story, every read) routes through the SW RPC. See
 * `docs/superpowers/specs/2026-06-11-position-store-service-worker.md`
 * §"Thin-Client Interfaces" (single-writer rule).
 */

import type { PositionListEntry } from '../../../core/messaging/types';

export interface PopupHistoryClient {
  /** Full reading history, most-recent first (position/list). */
  list(): Promise<PositionListEntry[]>;
  /** Delete one entry by URL — trusted popup param (position/delete). */
  delete(url: string): Promise<void>;
  /** Wipe all entries (position/clear-all). */
  clearAll(): Promise<void>;
}

type Response = { ok: true; data: unknown } | { ok: false; error: { kind: string } };

export function createPopupHistoryClient(api: typeof chrome = chrome): PopupHistoryClient {
  return {
    async list() {
      const resp = (await api.runtime.sendMessage({ type: 'position/list' })) as
        | Response
        | undefined;
      if (!resp || !resp.ok) return [];
      return (resp.data as PositionListEntry[]) ?? [];
    },

    async delete(url) {
      const resp = (await api.runtime.sendMessage({ type: 'position/delete', url })) as
        | Response
        | undefined;
      if (!resp || !resp.ok) {
        throw new Error(`position/delete failed: ${resp ? resp.error.kind : 'no-response'}`);
      }
    },

    async clearAll() {
      const resp = (await api.runtime.sendMessage({ type: 'position/clear-all' })) as
        | Response
        | undefined;
      if (!resp || !resp.ok) {
        throw new Error(`position/clear-all failed: ${resp ? resp.error.kind : 'no-response'}`);
      }
    },
  };
}
