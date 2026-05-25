import { describe, it, expect } from 'vitest';
import { THEME_IDS, THEME_TOKENS } from '../tokens';

// Pure WCAG 2.1 relative-luminance + contrast-ratio math. No JSDOM, no
// axe-core, no synthetic overlay markup that does not exist yet. This pins
// the real invariant ADR #0002 requires: every named theme's bg+text and
// surface+text pairs meet WCAG AA (4.5:1) for body text.
//
// Honest scope: this verifies the TOKEN VALUES themselves, not the applier's
// var pipeline (covered by applier.test.ts) and not the real overlay (which
// does not exist yet — issue #74 explicitly defers the overlay surface).
// A real-browser Playwright contrast sweep is the ultimate ground truth and
// is filed as a follow-up to this PR.

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

const WCAG_AA_BODY = 4.5;
const WCAG_AA_LARGE = 3.0;

describe('WCAG AA contrast — bg vs text per theme', () => {
  it.each(THEME_IDS)('"%s" bg vs text meets AA body (≥ 4.5:1)', (theme) => {
    const { bg, text } = THEME_TOKENS[theme];
    const ratio = contrastRatio(bg, text);
    expect(ratio, `${theme}: bg=${bg} text=${text} → ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
      WCAG_AA_BODY,
    );
  });
});

describe('WCAG AA contrast — surface vs text per theme', () => {
  it.each(THEME_IDS)('"%s" surface vs text meets AA body (≥ 4.5:1)', (theme) => {
    const { surface, text } = THEME_TOKENS[theme];
    const ratio = contrastRatio(surface, text);
    expect(
      ratio,
      `${theme}: surface=${surface} text=${text} → ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(WCAG_AA_BODY);
  });
});

describe('WCAG AA contrast — bg vs accent (large/UI) per theme', () => {
  // Accent is used for focus rings, primary buttons, and link-like affordances.
  // Large-text / non-text AA = 3.0. Stricter body AA may not hold for accent
  // soft palettes (e.g. cream's bg #fbf9f4 vs accent #1a73e8 is fine, but
  // intentionally bright accents on dark surfaces sometimes hover).
  it.each(THEME_IDS)('"%s" bg vs accent meets AA large/UI (≥ 3.0:1)', (theme) => {
    const { bg, accent } = THEME_TOKENS[theme];
    const ratio = contrastRatio(bg, accent);
    expect(
      ratio,
      `${theme}: bg=${bg} accent=${accent} → ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
  });
});

describe('WCAG AA contrast — accentSoft tinted-bg per theme', () => {
  // accentSoft is used as a tinted background BEHIND text (badge labels,
  // hover surfaces, soft callouts). Text rendered on accentSoft must meet
  // AA body (4.5). A typo collapsing accentSoft to accent would fail here.
  it.each(THEME_IDS)('"%s" accentSoft vs text meets AA body (≥ 4.5:1)', (theme) => {
    const { accentSoft, text } = THEME_TOKENS[theme];
    const ratio = contrastRatio(accentSoft, text);
    expect(
      ratio,
      `${theme}: accentSoft=${accentSoft} text=${text} → ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(WCAG_AA_BODY);
  });

  it.each(THEME_IDS)('"%s" accentSoft distinct from accent (typo guard)', (theme) => {
    const { accent, accentSoft } = THEME_TOKENS[theme];
    expect(accent.toLowerCase()).not.toBe(accentSoft.toLowerCase());
  });
});
