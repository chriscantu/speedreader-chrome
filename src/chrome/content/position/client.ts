/**
 * Content-script position client (#196).
 *
 * The CS is a thin, least-privilege client: it can read/write/clear the
 * position for its OWN current page only. It has NO `chrome.storage.local`
 * access (the SW's `setAccessLevel('TRUSTED_CONTEXTS')` revoked it) and NO
 * message type that names a URL — the SW binds the URL from `sender.url`. The
 * `url` parameter is deliberately absent from this interface: a url-accepting
 * CS client would imply cross-URL reads work, the exact misconception the
 * threat model forbids. See
 * `docs/superpowers/specs/2026-06-11-position-store-service-worker.md`
 * §"Thin-Client Interfaces".
 */

import type {
  ReadingPosition,
  WritableReadingPosition,
} from '../../../core/storage/reading-position';

export interface ContentPositionClient {
  /** Read this page's saved position (position/get). */
  read(): Promise<ReadingPosition | undefined>;
  /** Persist this page's position (position/set). */
  write(p: WritableReadingPosition): Promise<void>;
  /** Drop this page's saved position (position/clear). */
  clear(): Promise<void>;
}

type Response = { ok: true; data: unknown } | { ok: false; error: { kind: string } };

export function createContentPositionClient(api: typeof chrome = chrome): ContentPositionClient {
  return {
    async read() {
      const resp = (await api.runtime.sendMessage({ type: 'position/get' })) as
        | Response
        | undefined;
      if (!resp || !resp.ok) return undefined;
      // Handler returns `ReadingPosition | null`. Normalize null → undefined.
      return (resp.data as ReadingPosition | null) ?? undefined;
    },

    async write(p) {
      const resp = (await api.runtime.sendMessage({
        type: 'position/set',
        wordIndex: p.wordIndex,
        totalWords: p.totalWords,
      })) as Response | undefined;
      if (!resp || !resp.ok) {
        throw new Error(`position/set failed: ${resp ? resp.error.kind : 'no-response'}`);
      }
    },

    async clear() {
      const resp = (await api.runtime.sendMessage({ type: 'position/clear' })) as
        | Response
        | undefined;
      if (!resp || !resp.ok) {
        throw new Error(`position/clear failed: ${resp ? resp.error.kind : 'no-response'}`);
      }
    },
  };
}
