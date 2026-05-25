import { describe, it, expect } from 'vitest';
import { THEME_IDS, THEME_TOKENS, TOKEN_KEYS, isThemeId, type ThemeId } from '../tokens';

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

describe('THEME_TOKENS', () => {
  it('lists all 6 themes adjudicated in ADR #0002', () => {
    expect(THEME_IDS).toEqual(['light', 'dark', 'sepia', 'paper', 'cream', 'nord']);
  });

  it.each(THEME_IDS)('theme "%s" defines all 5 token slots', (theme) => {
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
});

describe('isThemeId', () => {
  it.each(THEME_IDS)('accepts known theme "%s"', (theme: ThemeId) => {
    expect(isThemeId(theme)).toBe(true);
  });

  it.each([null, undefined, 0, '', 'LIGHT', 'unknown', {}])(
    'rejects non-theme value %p',
    (value) => {
      expect(isThemeId(value)).toBe(false);
    },
  );
});
