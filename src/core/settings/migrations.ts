import { SettingsSchemaV4, CURRENT_VERSION, type SettingsV4 } from './schema';
import { DEFAULT_SETTINGS } from './defaults';

type Migrator = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Sequential migrators keyed by source version. Forward-only chain:
 * `0 -> 1 -> 2 -> 3 -> 4 -> ...`. To add a 4->5 migration in the future,
 * drop in `4: m4to5` and bump `CURRENT_VERSION` in `schema.ts`.
 *
 * Spread order is load-bearing: `...raw` first, then literals. New
 * payloads get the literal `alignment: 'orp'` stamp; V4-already-present
 * payloads bypass this map entirely because the `while (v < CURRENT_VERSION)`
 * loop in `migrate()` short-circuits when `v === 4`.
 *
 * 2 -> 3 (#101) is value-preserving: the V2 theme set
 * (`light | dark | system`) is a strict subset of the V3 set, so the
 * migrator only stamps the version literal. New design-pack themes
 * (`sepia | paper | cream | nord`) became reachable only after the V3
 * enum widening landed.
 *
 * 3 -> 4 (#72) adds three context-menu integration fields:
 * `contextLine: false`, `startFromWordOne: false`, and `lastUsedWpm`
 * defaulted from the payload's current `wpm` (so the first post-migration
 * submenu open shows the user's actual reading speed, not the default).
 *
 * `lastUsedWpm` is clamped + rounded to the V4 schema constraint
 * (`int [100, 600], multipleOf(10)`) so a corrupt or out-of-range
 * `raw.wpm` doesn't propagate into `lastUsedWpm` and force the final
 * `safeParse` to nuke the entire payload to defaults. The whole-payload
 * fallback still fires if `raw.wpm` itself fails V4 validation — this
 * clamp only protects the derived `lastUsedWpm` field.
 */
function clampLastUsedWpm(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 250;
  const clamped = Math.max(100, Math.min(600, raw));
  return Math.round(clamped / 10) * 10;
}

const MIGRATIONS: Record<number, Migrator> = {
  0: (raw) => ({ ...raw, version: 1 }),
  1: (raw) => ({ ...raw, alignment: 'orp', version: 2 }),
  2: (raw) => ({ ...raw, version: 3 }),
  3: (raw) => ({
    ...raw,
    contextLine: false,
    startFromWordOne: false,
    lastUsedWpm: clampLastUsedWpm(raw.wpm),
    version: 4,
  }),
};

/**
 * Best-effort migration. Never throws — corrupt or schema-incompatible input
 * falls back to a fresh copy of `DEFAULT_SETTINGS` so a malformed payload
 * cannot crash the service worker on cold start.
 *
 * Signature is intentionally one-arg (#66): the migrator owns version detection
 * by reading `rawValue.version`, and the sole caller (`loadSettings` in
 * `src/chrome/settings/storage.ts`) does not know — and should not have to know
 * — the source version. If a second caller ever needs to assert `fromVersion`
 * (e.g. a future export/import flow rejecting forward-incompat blobs), revisit
 * by adding an optional second arg rather than overloading; do not break the
 * existing single-caller contract.
 *
 * Missing-field repair is intentional forward-compat (#67): after the
 * version-chain loop runs, the result is shallow-merged onto `DEFAULT_SETTINGS`
 * before `safeParse`, so a stored payload missing a field added in a later
 * schema revision (or one truncated by a partial sync) acquires the default
 * value instead of failing validation. The test pinning this behavior is
 * `'migrates v3 blob with missing field by filling defaults (explicit repair
 * behavior)'` in `__tests__/migrations.test.ts`.
 */
export function migrate(rawValue: unknown): SettingsV4 {
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
  const parsed = SettingsSchemaV4.safeParse(merged);
  if (!parsed.success) {
    console.warn(
      '[speedreader] settings failed validation, falling back to defaults',
      parsed.error,
    );
    return { ...DEFAULT_SETTINGS };
  }
  return parsed.data;
}
