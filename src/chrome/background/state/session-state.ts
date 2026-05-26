/**
 * Per-tab reader session state persisted in `chrome.storage.session`.
 *
 * Per the SW-lifecycle spec (`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"State Recovery After SW Idle-Kill"):
 *
 * - `chrome.storage.session` is the correct tier — cleared on browser
 *   restart (yesterday's position is meaningless). Requires Chrome 102+.
 * - Persisted shape carries `{tabId, scope, wpm, positionIndex, sourceHash}`
 *   ONLY. No raw selection text (PII risk; CS re-extracts on resume).
 * - Schema MUST be re-validated on every read — disk contents are
 *   untrusted (storage extension, browser sync, manual edit).
 * - `sourceHash` mismatch on resume → discard, start fresh. The CS owns
 *   the hash computation per the spec.
 *
 * Keys are namespaced `session:v1:<tabId>` so a future schema bump can
 * coexist with old data.
 */

export interface SessionState {
  tabId: number;
  scope: 'selection' | 'full';
  wpm: number;
  positionIndex: number;
  sourceHash: string;
}

const KEY_PREFIX = 'session:v1:';

function keyFor(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate a raw payload (read from storage) against the `SessionState`
 * schema AND against the expected `sourceHash`. Returns the validated
 * state on success, `null` on any failure (shape, types, or hash
 * mismatch). Callers that receive `null` MUST treat the slot as empty
 * and start fresh.
 *
 * Bounds-checking notes:
 * - `positionIndex` must be a non-negative integer (NaN, negatives, and
 *   non-integers are rejected).
 * - `wpm` is type-checked (number) only — full bounds-checking against
 *   settings (100–600) lives in the caller; this validator stays narrow.
 */
export function validateSession(raw: unknown, expectedSourceHash: string): SessionState | null {
  if (!isObject(raw)) return null;

  const { tabId, scope, wpm, positionIndex, sourceHash } = raw;

  if (typeof tabId !== 'number' || !Number.isInteger(tabId)) return null;
  if (scope !== 'selection' && scope !== 'full') return null;
  if (typeof wpm !== 'number' || !Number.isFinite(wpm)) return null;
  if (typeof positionIndex !== 'number' || !Number.isInteger(positionIndex) || positionIndex < 0) {
    return null;
  }
  if (typeof sourceHash !== 'string' || sourceHash.length === 0) return null;

  if (sourceHash !== expectedSourceHash) return null;

  return { tabId, scope, wpm, positionIndex, sourceHash };
}

/**
 * Persist a session state. The caller owns ordering / debouncing; this
 * function is a thin write. The full CAS-on-positionIndex semantics live
 * in the (separate) session-locks layer per the spec.
 */
export async function saveSession(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [keyFor(state.tabId)]: state });
}

/**
 * Load and validate a session for a given tab.
 *
 * `expectedSourceHash` is REQUIRED — the caller must obtain it from the
 * CS-side hash computation per the SW-lifecycle spec §"sourceHash resume
 * gate". Self-comparing the stored hash to itself is a no-op and would
 * defeat the resume guard (the whole point: detect content change under
 * the user). Making the parameter required closes the silent-skip path
 * that the prior signature allowed.
 *
 * Returns `null` if the slot is absent, the payload fails shape
 * validation, OR the stored `sourceHash` does not match
 * `expectedSourceHash`. Callers that receive `null` MUST treat the slot
 * as empty and start fresh.
 */
export async function loadSession(
  tabId: number,
  expectedSourceHash: string,
): Promise<SessionState | null> {
  const key = keyFor(tabId);
  const result = await chrome.storage.session.get(key);
  const raw = (result as Record<string, unknown>)[key];
  if (raw === undefined) return null;
  return validateSession(raw, expectedSourceHash);
}
