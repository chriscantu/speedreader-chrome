import { z } from 'zod';

export const SettingsSchemaV2 = z.object({
  version: z.literal(2),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['light', 'dark', 'system']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
});

export type SettingsV2 = z.infer<typeof SettingsSchemaV2>;

export const CURRENT_VERSION = 2 as const;

/**
 * Cardinality-pinned constant mirroring Safari's `VALID_ALIGNMENTS`.
 * Used by tests today; consumed by the future Options-page UI radio
 * group (#30 follow-up) and overlay rendering wiring (pairs with #19).
 * Widening the enum is a future ADR — keep this in lockstep with the
 * `alignment` field in `SettingsSchemaV2` above.
 */
export const VALID_ALIGNMENTS = ['orp', 'center'] as const;
