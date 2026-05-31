import { z } from 'zod';
import { SettingsSchemaV5 } from '../settings/schema';

/**
 * Per-activation override payload — applied by the CS as one-shot deltas
 * to the live settings snapshot.
 *
 * Two-gate design (see spec §"Activation Payload Extension — Receive-Side
 * Validation"):
 *
 *  - **Shape gate** (`validateOverrides`) checks primitive types only:
 *    `wpm` must be a number, toggles must be booleans. Out-of-bound values
 *    PASS the shape gate — they're caught downstream.
 *  - **Bounds gate** (`pickValidOverrides`) drops fields that fail their
 *    real per-field schema (`SettingsSchemaV5.shape.wpm` for wpm: int,
 *    [100,600], multipleOf(10); strict-boolean for toggles).
 *
 * Why split: the bounds gate reuses `SettingsSchemaV5.shape.wpm` so the
 * `wpm` constraint stays the single source of truth (no duplication).
 * The shape gate intentionally relaxes wpm to `z.number()` so a hostile
 * 999999 payload reaches the bounds gate to be dropped per-field rather
 * than nuking the entire overrides object at the shape gate — keeps the
 * activation alive with snapshot defaults for the other fields.
 *
 * Field-name alignment: `contextLine` / `startFromWordOne` here match
 * the `SettingsV6` field names exactly so the CS-side
 * `{...snapshot, ...validatedOverrides}` shallow-merge composes
 * cleanly without a wire→settings translation table. The hi-fi mock's
 * "Show context line" submenu label is a display string, not the wire
 * name.
 *
 * `.strip()` (Zod default) silently drops unknown keys — chosen over
 * `.strict()` so a future sender that adds an `overrides.theme` field
 * doesn't hard-reject older clients (graceful forward-compat). Forgery
 * defense lives at sender-provenance (sender.id check in the unified
 * onMessage listener — `src/chrome/background/messaging/on-message.ts`
 * `handleOnMessage`), not at unknown-key strictness.
 */
export const OverridesSchema = z.object({
  wpm: z.number().optional(),
  contextLine: z.boolean().optional(),
  startFromWordOne: z.boolean().optional(),
});

export type Overrides = z.infer<typeof OverridesSchema>;

/**
 * Shape gate. Returns parsed `Overrides` on success; `null` if `raw` is not
 * an object-shaped overrides payload at all (string, array, `null`, etc.)
 * OR if a typed field is present with a wrong primitive type
 * (e.g., `wpm: 'fast'`, `contextLine: 'true'`). Per-field bounds (range,
 * integer, multipleOf) are NOT enforced here — that's `pickValidOverrides`.
 */
export function validateOverrides(raw: unknown): Overrides | null {
  const result = OverridesSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Per-field bounds gate. Walks an already-shape-valid `Overrides` and drops
 * any field that fails its per-field schema (out-of-bound `wpm`, non-integer
 * `wpm`, non-`multipleOf(10)` `wpm`, non-boolean toggles). Returns the
 * remaining valid subset (possibly empty). Never throws.
 */
export function pickValidOverrides(raw: Overrides): Overrides {
  const out: Overrides = {};
  if (raw.wpm !== undefined) {
    const r = SettingsSchemaV5.shape.wpm.safeParse(raw.wpm);
    if (r.success) out.wpm = r.data;
  }
  if (raw.contextLine !== undefined && typeof raw.contextLine === 'boolean') {
    out.contextLine = raw.contextLine;
  }
  if (raw.startFromWordOne !== undefined && typeof raw.startFromWordOne === 'boolean') {
    out.startFromWordOne = raw.startFromWordOne;
  }
  return out;
}
