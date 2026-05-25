import { SettingsSchemaV3, CURRENT_VERSION, type SettingsV3 } from './schema';
import { DEFAULT_SETTINGS } from './defaults';

type Migrator = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Sequential migrators keyed by source version. Forward-only chain:
 * `0 -> 1 -> 2 -> 3 -> ...`. To add a 3->4 migration in the future, drop
 * in `3: m3to4` and bump `CURRENT_VERSION` in `schema.ts`.
 *
 * Spread order is load-bearing: `...raw` first, then literals. New
 * payloads get the literal `alignment: 'orp'` stamp; V3-already-present
 * payloads bypass this map entirely because the `while (v < CURRENT_VERSION)`
 * loop in `migrate()` short-circuits when `v === 3`.
 *
 * 2 -> 3 (#101) is value-preserving: the V2 theme set
 * (`light | dark | system`) is a strict subset of the V3 set, so the
 * migrator only stamps the version literal. New design-pack themes
 * (`sepia | paper | cream | nord`) became reachable only after the V3
 * enum widening landed.
 */
const MIGRATIONS: Record<number, Migrator> = {
  0: (raw) => ({ ...raw, version: 1 }),
  1: (raw) => ({ ...raw, alignment: 'orp', version: 2 }),
  2: (raw) => ({ ...raw, version: 3 }),
};

/**
 * Best-effort migration. Never throws — corrupt or schema-incompatible input
 * falls back to a fresh copy of `DEFAULT_SETTINGS` so a malformed payload
 * cannot crash the service worker on cold start.
 */
export function migrate(rawValue: unknown): SettingsV3 {
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
  const parsed = SettingsSchemaV3.safeParse(merged);
  if (!parsed.success) {
    console.warn(
      '[speedreader] settings failed validation, falling back to defaults',
      parsed.error,
    );
    return { ...DEFAULT_SETTINGS };
  }
  return parsed.data;
}
