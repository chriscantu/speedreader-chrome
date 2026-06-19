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

describe('OVERLAY_CSS word-region vertical centering (issue #241)', () => {
  // #241 — the default (non-touch) `.word-region` previously used
  // `align-items: baseline`, so the streaming RSVP word hugged the top of
  // the region while the accent focus-ticks (anchored to the region's
  // vertical center) pointed at empty space. The fix centers the word at
  // the default breakpoint so the word and the ticks share one axis.
  //
  // The default rule is the one carrying `font-family: var(--font-mono)`
  // (the touch `@media (pointer: coarse)` `.word-region` override does not
  // restate font-family), so the regex binds to that block specifically to
  // avoid passing merely because the touch block already centers.
  test('default .word-region uses align-items: center (not baseline)', () => {
    const block = OVERLAY_CSS.match(
      /\.word-region\s*\{[^}]*font-family:\s*var\(--font-mono[^}]*\}/,
    )?.[0];
    expect(block, 'expected the default .word-region rule').not.toBeUndefined();
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).not.toMatch(/align-items:\s*baseline/);
  });

  // #241 — the responsive word size is governed by the clamp; the body
  // `fontSize` setting must NOT pin `--rsvp-font-size` to a default-driven
  // value (20px) that would override the clamp. The clamp must remain the
  // value the word region actually resolves to. This guards the CSS source
  // half of the decouple; the JS half (applyFontSize no longer writes the
  // property) is covered in font-size-stepper.test.ts.
  test('default .word-region keeps the responsive clamp as its font-size', () => {
    const block = OVERLAY_CSS.match(
      /\.word-region\s*\{[^}]*font-family:\s*var\(--font-mono[^}]*\}/,
    )?.[0];
    expect(block, 'expected the default .word-region rule').not.toBeUndefined();
    expect(block).toMatch(/font-size:[^;]*clamp\(40px,\s*8\.5cqi \+ 0\.5rem,\s*54px\)/);
  });

  // #247 — the clamp is the BASE; the A−/A+ stepper scales it via
  // `calc(clamp(...) * var(--rsvp-font-scale, 1))` so the reader can enlarge the
  // streaming word past the 54px ceiling (WCAG 1.4.4). The legacy absolute
  // `--rsvp-font-size` pin must be gone (it overrode the clamp → 20px word).
  // Mutation: dropping the `* var(--rsvp-font-scale, 1)` factor flips this RED.
  test('default .word-region scales the clamp by --rsvp-font-scale (no legacy --rsvp-font-size pin)', () => {
    const block = OVERLAY_CSS.match(
      /\.word-region\s*\{[^}]*font-family:\s*var\(--font-mono[^}]*\}/,
    )?.[0];
    expect(block, 'expected the default .word-region rule').not.toBeUndefined();
    expect(block).toMatch(
      /font-size:\s*calc\(\s*clamp\(40px,\s*8\.5cqi \+ 0\.5rem,\s*54px\)\s*\*\s*var\(--rsvp-font-scale,\s*1\)\s*\)/,
    );
    expect(block).not.toMatch(/var\(--rsvp-font-size/);
  });

  // #241 (a11y ring MED) — the accent focus-ticks must anchor to the region's
  // vertical CENTER, not its top/bottom EDGES. With the word now centered
  // (align-items: center) and the region free to grow (touch flex: 1 1 auto,
  // tall viewports), edge-anchored ticks (top: 18px / bottom: 6px) drift away
  // from the centered word, breaking the equidistant gaze-anchor. Center
  // anchoring (top: 50% + a vertical translate on each tick) keeps the two
  // ticks symmetric about the word at ANY region height.
  //
  // Mutation check: reverting ::before to `top: 18px` / ::after to
  // `bottom: 6px` (dropping the top: 50% center anchor) flips these RED.
  test('::before focus-tick anchors to vertical center (top: 50% + translate), not the top edge', () => {
    // Bind to the STANDALONE ::before rule, whose body opens directly with
    // `top:` (only whitespace after `{`). The shared `::before, ::after`
    // baseline block opens with `content:`, so anchoring the regex to
    // `{\s*top:` excludes it (and its comment, which mentions "top: 50%").
    const block = OVERLAY_CSS.match(/\.word-region::before\s*\{\s*top:[^}]*\}/)?.[0];
    expect(block, 'expected the standalone ::before tick rule').not.toBeUndefined();
    expect(block).toMatch(/top:\s*50%/);
    expect(block).toMatch(/transform:\s*translate\(-50%,/);
    expect(block).not.toMatch(/top:\s*18px/);
    // #247 (a11y ring HIGH) — the vertical offset must scale with the word so
    // the tick tracks the enlarged glyph instead of collapsing inside it.
    // Mutation: dropping the `* var(--rsvp-font-scale, 1)` factor flips this RED.
    expect(block).toMatch(/translate\(-50%,\s*calc\(-40px \* var\(--rsvp-font-scale,\s*1\)\)\)/);
  });

  test('::after focus-tick anchors to vertical center (top: 50% + translate), not the bottom edge', () => {
    // See ::before note — bind to the standalone rule via its `{\s*top:` open.
    const block = OVERLAY_CSS.match(/\.word-region::after\s*\{\s*top:[^}]*\}/)?.[0];
    expect(block, 'expected the standalone ::after tick rule').not.toBeUndefined();
    expect(block).toMatch(/top:\s*50%/);
    expect(block).toMatch(/transform:\s*translate\(-50%,/);
    expect(block).not.toMatch(/bottom:\s*6px/);
    // #247 (a11y ring HIGH) — see ::before note; the offset scales with the word.
    expect(block).toMatch(/translate\(-50%,\s*calc\(26px \* var\(--rsvp-font-scale,\s*1\)\)\)/);
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

describe('OVERLAY_CSS scrubber 44×44 thumb target (issue #205)', () => {
  // #205 upgraded the scrubber thumb to a WCAG 2.2 AAA (SC 2.5.5) 44×44 hit
  // target. Only the thumb pseudo is restyled (appearance:none); the input
  // keeps its native track + accent-color fill. jsdom has no paint, so these
  // guard the CSS-source invariant; the 44px drag-strip height + accent-color
  // survival are exercised in touch-smoke.spec.ts.
  test('webkit thumb is 44px with appearance:none', () => {
    const block = OVERLAY_CSS.match(/\.scrubber-slider::-webkit-slider-thumb\s*\{[^}]*\}/)?.[0];
    expect(block, 'expected the webkit thumb rule').not.toBeUndefined();
    expect(block).toMatch(/appearance:\s*none/);
    expect(block).toMatch(/block-size:\s*44px/);
  });

  test('moz thumb is 44px', () => {
    const block = OVERLAY_CSS.match(/\.scrubber-slider::-moz-range-thumb\s*\{[^}]*\}/)?.[0];
    expect(block, 'expected the moz thumb rule').not.toBeUndefined();
    expect(block).toMatch(/block-size:\s*44px/);
  });

  test('scrubber keeps accent-color (native track progress fill preserved)', () => {
    expect(OVERLAY_CSS).toMatch(/\.scrubber-slider\s*\{[^}]*accent-color:\s*var\(--accent/);
  });
});
