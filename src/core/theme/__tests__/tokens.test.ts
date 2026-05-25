import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { THEME_IDS, THEME_TOKENS } from '../tokens';

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const TOKEN_KEYS = ['bg', 'surface', 'text', 'accent', 'accentSoft'] as const;

// Parse the design-pack HTML to extract per-theme root tokens. The applier
// only writes 5 slots; we pin those against the Hi-Fi source so a typo in
// THEME_TOKENS is caught at test time. ADR #0002 names this file as the
// source of truth.
//
// Robustness: Hi-Fi.html has 20+ `[data-theme="dark"]` selectors (token block
// at top + component overrides scattered through). We use a GLOBAL regex and
// require the matched block to contain ALL 5 slot names — guards against a
// future reorder that puts a component override before the token block.
const REQUIRED_VAR_NAMES = ['bg', 'surface', 'text', 'accent', 'accent-soft'];

function parseHiFiTokens(): Record<string, Record<string, string>> {
  const html = readFileSync(
    resolve(__dirname, '../../../../docs/design/Speed Reader Hi-Fi.html'),
    'utf8',
  );

  const themes: Record<string, Record<string, string>> = {};

  themes.light = findTokenBlock(html, /:root\s*\{([^}]+)\}/g);
  for (const id of ['dark', 'sepia', 'paper', 'cream', 'nord']) {
    const re = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]+)\\}`, 'g');
    themes[id] = findTokenBlock(html, re);
  }

  return themes;
}

// Walk every match of `re` against `html` until one block contains all 5
// required token names. Throws if no qualifying block exists — surfaces
// silent drift instead of binding to the wrong selector.
function findTokenBlock(html: string, re: RegExp): Record<string, string> {
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const vars = extractVars(m[1]);
    if (REQUIRED_VAR_NAMES.every((name) => name in vars)) return vars;
  }
  throw new Error(
    `No Hi-Fi block matched ${re.source} containing all of ${REQUIRED_VAR_NAMES.join(', ')}`,
  );
}

function extractVars(body: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    vars[m[1].trim()] = m[2].trim();
  }
  return vars;
}

// Mapping from our slot names to the Hi-Fi CSS custom-property names.
const SLOT_TO_VAR: Record<(typeof TOKEN_KEYS)[number], string> = {
  bg: 'bg',
  surface: 'surface',
  text: 'text',
  accent: 'accent',
  accentSoft: 'accent-soft',
};

describe('THEME_TOKENS', () => {
  it('lists all 6 themes adjudicated in ADR #0002', () => {
    expect(THEME_IDS).toEqual(['light', 'dark', 'sepia', 'paper', 'cream', 'nord']);
  });

  it.each(THEME_IDS)('theme "%s" defines all 5 token slots as hex', (theme) => {
    const tokens = THEME_TOKENS[theme];
    for (const key of TOKEN_KEYS) {
      expect(tokens[key], `${theme}.${key}`).toMatch(HEX_PATTERN);
    }
  });

  it.each(THEME_IDS)('theme "%s" has distinct bg vs text (no zero-contrast slip)', (theme) => {
    const tokens = THEME_TOKENS[theme];
    expect(tokens.bg.toLowerCase()).not.toBe(tokens.text.toLowerCase());
  });

  it('every theme has the same set of token keys', () => {
    const lightKeys = Object.keys(THEME_TOKENS.light).sort();
    for (const theme of THEME_IDS) {
      expect(Object.keys(THEME_TOKENS[theme]).sort()).toEqual(lightKeys);
    }
  });

  describe('hex values match docs/design/Speed Reader Hi-Fi.html (single source of truth)', () => {
    const hiFi = parseHiFiTokens();
    it.each(THEME_IDS)('theme "%s" tokens match Hi-Fi source', (theme) => {
      const source = hiFi[theme];
      expect(source, `Hi-Fi block for theme "${theme}"`).toBeTruthy();
      for (const slot of TOKEN_KEYS) {
        const sourceKey = SLOT_TO_VAR[slot];
        const sourceValue = source[sourceKey]?.toLowerCase();
        expect(sourceValue, `Hi-Fi --${sourceKey} for ${theme}`).toBeTruthy();
        expect(THEME_TOKENS[theme][slot].toLowerCase()).toBe(sourceValue);
      }
    });
  });
});

describe('THEME_TOKENS immutability', () => {
  it('is deeply frozen — typo-poisoning protection', () => {
    expect(Object.isFrozen(THEME_TOKENS)).toBe(true);
    for (const theme of THEME_IDS) {
      expect(Object.isFrozen(THEME_TOKENS[theme])).toBe(true);
    }
  });

  it('throws in strict mode when a downstream tries to mutate a token', () => {
    expect(() => {
      // @ts-expect-error — testing runtime guard against frozen mutation
      THEME_TOKENS.dark.bg = '#000000';
    }).toThrow();
  });
});
