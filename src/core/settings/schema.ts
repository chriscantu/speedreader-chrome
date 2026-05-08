import { z } from 'zod';

export const SettingsSchemaV1 = z.object({
  version: z.literal(1),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['light', 'dark', 'system']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
});

export type SettingsV1 = z.infer<typeof SettingsSchemaV1>;

export const CURRENT_VERSION = 1 as const;
