// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, CSS_VAR_NAMES } from '../applier';
import { THEME_IDS, THEME_TOKENS } from '../tokens';

describe('applyTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
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

  it('switching themes replaces all 5 vars', () => {
    applyTheme('light', root);
    applyTheme('nord', root);
    const tokens = THEME_TOKENS.nord;
    expect(root.style.getPropertyValue('--bg')).toBe(tokens.bg);
    expect(root.style.getPropertyValue('--accent')).toBe(tokens.accent);
    expect(root.style.getPropertyValue('--accent-soft')).toBe(tokens.accentSoft);
  });

  it('writes to the given root, not document.documentElement', () => {
    applyTheme('dark', root);
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe(THEME_TOKENS.dark.bg);
  });
});
