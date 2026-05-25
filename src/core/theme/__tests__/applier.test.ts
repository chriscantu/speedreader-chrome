// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme } from '../applier';
import { THEME_IDS, THEME_TOKENS, type ThemeId } from '../tokens';

const CSS_VAR_NAMES = ['--bg', '--surface', '--text', '--accent', '--accent-soft'] as const;

describe('applyTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  });

  it.each(THEME_IDS)('writes all 5 CSS custom props for "%s"', (theme) => {
    applyTheme(theme, root);
    const tokens = THEME_TOKENS[theme];
    expect(root.style.getPropertyValue('--bg')).toBe(tokens.bg);
    expect(root.style.getPropertyValue('--surface')).toBe(tokens.surface);
    expect(root.style.getPropertyValue('--text')).toBe(tokens.text);
    expect(root.style.getPropertyValue('--accent')).toBe(tokens.accent);
    expect(root.style.getPropertyValue('--accent-soft')).toBe(tokens.accentSoft);
  });

  it('is idempotent — re-applying the same theme is a no-op observable diff', () => {
    applyTheme('dark', root);
    const before = CSS_VAR_NAMES.map((v) => root.style.getPropertyValue(v));
    applyTheme('dark', root);
    const after = CSS_VAR_NAMES.map((v) => root.style.getPropertyValue(v));
    expect(after).toEqual(before);
  });

  it('switching themes fully replaces all 5 vars (no residue from prior theme)', () => {
    applyTheme('dark', root);
    applyTheme('light', root);
    const tokens = THEME_TOKENS.light;
    expect(root.style.getPropertyValue('--bg')).toBe(tokens.bg);
    expect(root.style.getPropertyValue('--surface')).toBe(tokens.surface);
    expect(root.style.getPropertyValue('--text')).toBe(tokens.text);
    expect(root.style.getPropertyValue('--accent')).toBe(tokens.accent);
    expect(root.style.getPropertyValue('--accent-soft')).toBe(tokens.accentSoft);
  });

  it('writes to the given root, not document.documentElement', () => {
    applyTheme('dark', root);
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe(THEME_TOKENS.dark.bg);
  });

  it('throws RangeError on unknown theme at runtime (chrome.storage corruption defense)', () => {
    expect(() => applyTheme('hacker' as ThemeId, root)).toThrow(RangeError);
    expect(() => applyTheme('' as ThemeId, root)).toThrow(RangeError);
    expect(() => applyTheme(undefined as unknown as ThemeId, root)).toThrow(RangeError);
  });
});
