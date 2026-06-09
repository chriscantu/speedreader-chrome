/**
 * styles.test.ts — issue #150
 *
 * Selector-bound guards that OVERLAY_CSS continues to consume the
 * `--surface` and `--accent-soft` theme slots written by the theming
 * applier (`src/core/theme/applier.ts`). The applier writes five slots
 * per ADR #0002; before #150 the overlay consumed only three, leaving
 * `--surface` and `--accent-soft` as dead surface area on the contract.
 *
 * Bare substring checks (`OVERLAY_CSS.includes('var(--surface')`)
 * would survive deleting any specific consumer as long as ONE
 * `var(--surface)` reference existed anywhere in the sheet — including
 * a comment or an unrelated rule. The regex assertions below bind the
 * guard to the load-bearing selector + property pair, so a deletion of
 * `.modal { background: var(--surface, …) }` or any of the three
 * `:hover { background: var(--accent-soft, …) }` rules surfaces here
 * instead of silently reverting the floor. Identified during the
 * adversarial-ring critique of PR for #150 (test-gap finding #1).
 *
 * Visual pairing (accentSoft↔text contrast, surface↔text contrast)
 * is covered at the token layer by
 * `src/core/theme/__tests__/contrast.test.ts`. The selector-bound
 * `color: var(--text` assertion on the hover rules guards against a
 * refactor that decouples the hover foreground from `--text` (which
 * would silently invalidate the contrast pairing — also a test-gap
 * critic finding).
 */
import { describe, expect, test } from 'vitest';
import { OVERLAY_CSS } from '../styles';

describe('OVERLAY_CSS theme-slot consumers (issue #150)', () => {
  test('.modal binds its background to var(--surface, …)', () => {
    expect(OVERLAY_CSS).toMatch(/\.modal\s*\{[^}]*background:\s*var\(--surface/);
  });

  test('.close-btn:hover binds background to var(--accent-soft, …)', () => {
    expect(OVERLAY_CSS).toMatch(/\.close-btn:hover\s*\{[^}]*background:\s*var\(--accent-soft/);
  });

  test('.play-pause-btn:hover binds background to var(--accent-soft, …)', () => {
    // #215 — hover is guarded `:not([aria-disabled='true'])` so the disabled
    // ('done') chip does not light up on hover.
    expect(OVERLAY_CSS).toMatch(
      /\.play-pause-btn:hover:not\(\[aria-disabled='true'\]\)\s*\{[^}]*background:\s*var\(--accent-soft/,
    );
  });

  test('.scope-swap-btn:hover binds background to var(--accent-soft, …)', () => {
    expect(OVERLAY_CSS).toMatch(/\.scope-swap-btn:hover\s*\{[^}]*background:\s*var\(--accent-soft/);
  });

  test('every accent-soft hover rule keeps foreground bound to var(--text, …) for contrast', () => {
    // Find every `:hover { … var(--accent-soft … }` block and assert each
    // also pins `color: var(--text`. A future refactor that drops the
    // color binding would silently invalidate the accentSoft↔text
    // contrast pairing proven at the token layer in contrast.test.ts.
    const hoverBlocks = OVERLAY_CSS.match(/[^{}]+:hover\s*\{[^}]*var\(--accent-soft[^}]*\}/g);
    expect(hoverBlocks, 'expected at least one accent-soft hover rule').not.toBeNull();
    for (const block of hoverBlocks ?? []) {
      expect(block).toMatch(/color:\s*var\(--text/);
    }
  });
});

describe('OVERLAY_CSS resume-toast is out of flow (issue #218)', () => {
  // The resume toast (#48) is inserted in flow directly above the word
  // region and removed on its 5 s auto-dismiss / Start Over. While it was
  // in flow, removal collapsed its ~37 px band and shifted the word region
  // up mid-read — a layout jump the project's neurodivergent audience is
  // sensitive to. Pinning the toast out of flow makes appearance AND
  // dismissal reflow-free. jsdom has no layout engine, so this guards the
  // structural invariant in the CSS source; visual CLS confirmation lives
  // in a Playwright pass (noted on #218).
  test('.resume-toast is taken out of flow (position: absolute|fixed)', () => {
    expect(OVERLAY_CSS).toMatch(/\.resume-toast\s*\{[^}]*position:\s*(absolute|fixed)/);
  });
});

describe('OVERLAY_CSS disabled-button a11y treatment (issue #215)', () => {
  // #215 extended the #214 WPM-stepper treatment to the font stepper and
  // play-pause buttons: native `:disabled` (drops out of tab chain) and
  // `opacity` (collapses WCAG 1.4.11 3:1 non-text contrast) replaced with
  // `[aria-disabled="true"]` + a muted color token. jsdom has no layout/paint,
  // so these guard the CSS-source invariant; the tab-chain + handler behavior
  // is covered by font-size-stepper.test.ts and play-pause.test.ts, and axe
  // runs in the e2e overlay-polish pass.
  test('font stepper disabled rule keys on [aria-disabled] and uses --text-muted', () => {
    expect(OVERLAY_CSS).toMatch(
      /\.font-dec-btn\[aria-disabled='true'\],\s*\.font-inc-btn\[aria-disabled='true'\]\s*\{[^}]*color:\s*var\(--text-muted/,
    );
  });

  test('font stepper disabled rule does NOT reintroduce opacity (1.4.11 regression guard)', () => {
    const block = OVERLAY_CSS.match(
      /\.font-dec-btn\[aria-disabled='true'\],\s*\.font-inc-btn\[aria-disabled='true'\]\s*\{[^}]*\}/,
    )?.[0];
    expect(block, 'expected the font aria-disabled rule').not.toBeUndefined();
    expect(block).not.toMatch(/opacity/);
  });

  test('play-pause disabled rule keys on [aria-disabled] and drops opacity', () => {
    const block = OVERLAY_CSS.match(/\.play-pause-btn\[aria-disabled='true'\]\s*\{[^}]*\}/)?.[0];
    expect(block, 'expected the play-pause aria-disabled rule').not.toBeUndefined();
    expect(block).toMatch(/color:\s*var\(--text-muted/);
    expect(block).not.toMatch(/opacity/);
  });
});
