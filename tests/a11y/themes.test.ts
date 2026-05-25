// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import axe from 'axe-core';
import { THEME_IDS, THEME_TOKENS, type ThemeId } from '../../src/core/theme';

// axe-core under JSDOM cannot resolve CSS var(--x) cascades the way a real
// browser engine does. So this suite renders synthetic markup with INLINE
// resolved color/background-color pairs — verifying THE TOKEN VALUES, not
// the applier's var pipeline (applier wiring is covered by applier.test.ts).
// A real-browser Playwright sweep is the ground truth and is out of scope
// for this PR; documented as a builder self-weakness in the PR body.

function setInlineStyles(
  el: HTMLElement,
  styles: Partial<Record<'backgroundColor' | 'color' | 'padding' | 'fontSize', string>>,
): void {
  for (const [k, v] of Object.entries(styles)) {
    if (v !== undefined) (el.style as unknown as Record<string, string>)[k] = v;
  }
}

function renderThemeFixture(theme: ThemeId): void {
  const t = THEME_TOKENS[theme];

  // Clear and rebuild via createElement — no innerHTML, no template injection.
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);

  const main = document.createElement('main');
  main.id = 'overlay';
  setInlineStyles(main, { backgroundColor: t.bg, color: t.text, padding: '24px' });

  const section = document.createElement('section');
  setInlineStyles(section, { backgroundColor: t.surface, color: t.text, padding: '16px' });

  const h1 = document.createElement('h1');
  h1.textContent = 'Reader headline';
  setInlineStyles(h1, { backgroundColor: t.surface, color: t.text, fontSize: '18px' });

  const p = document.createElement('p');
  p.textContent = 'Body copy at a readable size.';
  setInlineStyles(p, { backgroundColor: t.surface, color: t.text, fontSize: '16px' });

  const button = document.createElement('button');
  button.textContent = 'Primary action';
  setInlineStyles(button, { backgroundColor: t.accent, color: t.bg, padding: '8px 12px' });

  const span = document.createElement('span');
  span.textContent = 'Soft accent label';
  setInlineStyles(span, { backgroundColor: t.accentSoft, color: t.text, padding: '2px 6px' });

  section.append(h1, p, button, span);
  main.append(section);
  document.body.append(main);

  document.documentElement.setAttribute('data-theme', theme);
}

describe('axe-core color-contrast per theme', () => {
  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    document.documentElement.removeAttribute('data-theme');
  });

  it.each(THEME_IDS)('"%s" passes color-contrast (axe-core, inline-resolved)', async (theme) => {
    renderThemeFixture(theme);
    const results = await axe.run(document.body, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });
    const violations = results.violations.filter((v) => v.id === 'color-contrast');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe('forced-colors variant (JSDOM mock)', () => {
  // JSDOM does NOT simulate the visual substitution of system color keywords
  // (Canvas, CanvasText, LinkText). We verify only that (a) the applier-written
  // vars remain on the root when forced-colors is "active", and (b) the
  // documented CSS-side fallback contract (custom props can be overridden by
  // a @media (forced-colors: active) rule) is structurally sound — i.e. the
  // applier uses setProperty so the cascade can win. Real-browser verification
  // is out of scope (Playwright follow-up).

  it.each(THEME_IDS)(
    '"%s": applier writes setProperty so a forced-colors @media rule can override',
    async (theme) => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes('forced-colors: active'),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;

      const { applyTheme } = await import('../../src/core/theme/applier');
      const root = document.createElement('div');
      document.body.appendChild(root);
      applyTheme(theme, root);

      expect(root.style.getPropertyValue('--bg')).toBe(THEME_TOKENS[theme].bg);
      expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
    },
  );
});
