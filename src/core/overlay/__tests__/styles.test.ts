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
    expect(OVERLAY_CSS).toMatch(/\.play-pause-btn:hover\s*\{[^}]*background:\s*var\(--accent-soft/);
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
