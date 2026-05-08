import { SettingsSchemaV1, CURRENT_VERSION, type SettingsV1 } from './schema';
import { DEFAULT_SETTINGS } from './defaults';

type Migrator = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Sequential migrators keyed by source version. To add a 1->2 migration in
 * the future, drop in `1: m1to2` and bump `CURRENT_VERSION` in `schema.ts`.
 *
 * Identity hook for v0->v1 keeps the composition path exercised in tests
 * even while v1 is current.
 */
const MIGRATIONS: Record<number, Migrator> = {
  0: (raw) => ({ ...raw, version: 1 }),
};

/**
 * Best-effort migration. Never throws — corrupt or schema-incompatible input
 * falls back to a fresh copy of `DEFAULT_SETTINGS` so a malformed payload
 * cannot crash the service worker on cold start.
 */
export function migrate(rawValue: unknown): SettingsV1 {
  if (rawValue == null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return { ...DEFAULT_SETTINGS };
  }

  let value = { ...(rawValue as Record<string, unknown>) };
  let v = typeof value.version === 'number' ? value.version : 0;

  while (v < CURRENT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    value = step(value);
    v += 1;
  }

  const merged = { ...DEFAULT_SETTINGS, ...value, version: CURRENT_VERSION };
  const parsed = SettingsSchemaV1.safeParse(merged);
  if (!parsed.success) {
    console.warn('[speedreader] settings failed validation, falling back to defaults', parsed.error);
    return { ...DEFAULT_SETTINGS };
  }
  return parsed.data;
}
