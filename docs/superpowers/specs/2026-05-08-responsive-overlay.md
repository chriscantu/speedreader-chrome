# Responsive Overlay Spec

**Date:** 2026-05-08
**Status:** Approved
**Issue:** [#35 — Responsive overlay 320 px → 4K](https://github.com/chriscantu/speedreader-chrome/issues/35)
**Milestone:** M1 (MVP parity) with one explicit post-M1 carve-out (Document Picture-in-Picture).
**Scope:** Pin the overlay's responsive layout philosophy, scaling formulas, control-bar adaptation, accessibility-driven breakpoints, and Chrome-only platform improvements that meaningfully help neurodivergent readers.

---

## Problem Statement

The RSVP overlay is the only surface the reader actually sees while reading. It runs as a shadow-DOM island inside arbitrary host pages, which means we cannot rely on the host's CSS, cannot assume viewport equals usable space (DevTools, sidebars, split-screen browsers, and Document-PiP windows all consume part of the viewport), and cannot afford layout shift mid-read — losing ORP fixation costs the reader the line and is a primary failure mode for ADHD users.

Safari's reference implementation targets a fixed desktop layout. Porting that as-is would regress on phones (parity floor: 320 px) and would leave Chrome-only platform affordances on the table that genuinely improve the experience for neurodivergent users (Windows high-contrast users, Document-PiP for ADHD task-overlay reading).

The Safari extension is the **MVP floor, not the ceiling.**

## Constraints

- **Shadow-DOM isolation.** Overlay CSS cannot leak in or out. All styling is scoped; host CSS does not affect us.
- **Container-query-first.** The overlay's usable size is independent of the viewport (browser DevTools open at the side, browser sidebars, future Document-PiP at ~400×300). Viewport queries lie about our available space.
- **WCAG 2.2 AA at minimum.** 1.4.10 Reflow (no horizontal scroll at 320 CSS px / 400% zoom), 1.4.4 Resize Text (200% zoom without loss of content/function), 1.4.11 Non-text Contrast, 2.5.8 Target Size (Minimum) at 24×24 CSS px, and the AAA target of 44×44 where the overlay's primary controls are concerned.
- **No layout shift mid-read.** ORP column position MUST be stable once a session starts. Re-flow on container resize is permitted between sessions, not during.
- **MV3 + local-only.** Everything ships statically; no runtime CSS fetched from a CDN. No telemetry on which breakpoints fire.
- **Solo-maintainer.** Bias toward fewer breakpoints and simpler CSS over pixel-perfect tuning per device class.

## Decision

### 1. Breakpoint philosophy — fluid-first with two container-query inflections

Three tiers, measured against the overlay container via `@container`, **not** viewport:

- `narrow` — `< 480px` container width. Phone-portrait, narrow PiP, side-docked DevTools.
- `wide` — `480px – 1279px`. Default desktop, tablet landscape.
- `ultra` — `≥ 1280px`. 4K, 21:9, ultrawide.

```css
.overlay {
  container-type: inline-size;
  container-name: rsvp;
}

@container rsvp (max-width: 479px) {
  /* narrow */
}
@container rsvp (min-width: 1280px) {
  /* ultra  */
}
```

Between inflection points, type and spacing scale fluidly via `clamp()`. This satisfies WCAG 1.4.10 (Reflow): at the 320 CSS px floor, no horizontal scroll, no clipped controls. It also satisfies 1.4.4 (Resize Text) cleanly because everything is in `rem` / `cqi` / `ch` — a 200% browser zoom triples the container query thresholds in tandem with the type, so the overlay re-tiers on zoom the same way it does on resize.

### 2. Word-area sizing

```css
.word {
  font-size: clamp(2rem, 5.5cqi + 1rem, 5.5rem);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.reading-zone {
  max-inline-size: min(72ch, 1100px);
  margin-inline: auto;
}
```

- **Floor `2rem` (32 px @ default).** Minimum legible RSVP size for dyslexic readers per Atkinson Hyperlegible's recommended floor; below this ORP fixation degrades.
- **Fluid term `5.5cqi + 1rem`.** `cqi` is "1% of container inline size," so the word grows with the overlay, not the viewport. The `+ 1rem` baseline keeps the word usable when the container is very narrow (Document-PiP at 320 px wide → ~2.76rem, well above the floor).
- **Ceiling `5.5rem` (88 px @ default).** Above this, single-word RSVP starts to require saccades the format is meant to eliminate; the format breaks down before the screen runs out.
- **`max-inline-size: min(72ch, 1100px)`.** Caps the reading column on 4K and 21:9 monitors so ORP fixation doesn't drift across a meter of glass. `72ch` keeps the cap proportional to the chosen font; `1100px` is the absolute bound.

### 3. Control-bar adaptation

| Tier     | Layout                                                             | Target size                                               | Placement                                      |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| `narrow` | Single horizontal row, icon-only, condensed                        | `min-height: 44px` (AAA)                                  | **Bottom-pinned** within overlay (thumb-reach) |
| `wide`   | Icon + label, full controls visible                                | 40×40 CSS px (AA: ≥24, design: 40 for non-thumb pointers) | Top of reader pane                             |
| `ultra`  | Same as `wide`, controls grouped left/right with central word area | 40×40                                                     | Top of reader pane                             |

WCAG 2.5.8 minimum is 24×24. We go to 44×44 on `narrow` because that tier is presumed thumb-reachable and the cost is zero.

### 4. Context-preview placement

The previous-3 / upcoming-3 word peek (a documented ADHD comprehension aid) collapses by tier:

- `narrow`: previous-1 + upcoming-1 only, single line above and below the word. Three-word preview crowds out the ORP column on phones.
- `wide` / `ultra`: full previous-3 / upcoming-3.

### 5. Pointer vs touch

Touch affordances key off **input modality**, not container size — a Surface tablet at 1280 px is touch; a phone with a paired Bluetooth mouse is fine pointer. Conflating "small viewport" with "touch" is the regression the Safari version has.

```css
@media (pointer: coarse) {
  .control-bar button {
    min-height: 44px;
    min-width: 44px;
  }
}
@media (hover: hover) {
  .control-bar button:hover {
    /* hover affordance */
  }
}
```

`(pointer: coarse)` raises target sizes regardless of tier; `(hover: hover)` gates hover-only affordances so touch users never depend on a state they can't trigger.

### 6. Accessibility-driven breakpoints

- **200% zoom** — covered by the `rem`-based scale; tiers re-key on the scaled container width naturally. **Verify:** at 200% browser zoom on a 1280 px viewport, the overlay renders in `narrow` tier with no horizontal scroll.
- **400% zoom (WCAG 1.4.10 ceiling)** — at 1280 CSS px / 400%, content reflows to a 320 CSS px equivalent column. The overlay collapses to `narrow`; verify no clipped controls.
- **`forced-colors: active`** — Windows High Contrast Mode. Replace all custom colors with system tokens (`CanvasText`, `Canvas`, `Highlight`, `HighlightText`, `ButtonText`, `ButtonFace`). ORP highlight uses `Highlight` / `HighlightText`. **This is the #1 Chrome-only accessibility win over the Safari version (M1).**
- **`prefers-contrast: more`** — boost stroke widths and use the highest-contrast palette variant.
- **`prefers-reduced-motion: reduce`** — affects **overlay chrome transitions only** (fades, slides, control-bar reveals). It explicitly does **NOT** alter RSVP cadence; cadence is the format. Reducing it would slow reading without consent. Pause/resume affordance is the user's escape hatch for cadence; reduced-motion is the user's escape hatch for chrome.

  Photosensitive-seizure note: at user-configurable WPM ≥ 700 the per-word cadence approaches 12 Hz, well above WCAG 2.3.1's 3-flash/sec threshold for _flashing_. RSVP word swaps are not flashes (no luminance cycling against the same region), but the engine MUST hard-cap WPM at 1000 and surface a one-time warning above 600 WPM.

### 7. Chrome-only improvements over Safari

| Feature                                       | Tier                 | User benefit                                                                                                                                                  | Platform                                           | Fallback                                                                          | Cost                                                                                                                                                                             |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forced-colors` / `prefers-contrast` palettes | **M1**               | Windows HCM users get a usable overlay; AAA-grade contrast on demand                                                                                          | CSS only                                           | n/a — already covered by base styles                                              | ~30 lines of CSS, one fixture screenshot per palette                                                                                                                             |
| Document Picture-in-Picture reader            | **post-M1, flagged** | Read in a floating window over other apps. Genuine ADHD multitask unlock — read article while on a call, read docs while coding. Safari cannot do this today. | `documentPictureInPicture` API (Chrome 116+, Edge) | Falls back to in-page overlay if API absent or `documentPictureInPicture` rejects | **Doubles overlay layout test surface** — every container-query tier must work in PiP windows down to ~240×180. Flagged behind `experimentalDocPiP` in settings; off by default. |
| `Highlight` API for ORP underline             | M1                   | Native, GPU-accelerated highlight rendering for the ORP letter; smoother at high WPM, no DOM mutation per tick                                                | CSS Custom Highlight API (Chrome 105+)             | Falls back to a styled `<span>` wrapping the ORP letter                           | Small. Adds one capability check; both code paths share the tokenizer output.                                                                                                    |
| `prefers-reduced-data` palette                | M1 (cheap)           | Disables decorative gradients/shadows on metered connections; reduces paint cost on low-end devices                                                           | CSS media query                                    | No-op when not asserted                                                           | ~5 lines.                                                                                                                                                                        |

Document-PiP is the headline post-M1 improvement. It's flagged not because it's risky but because it is the only proposed addition that meaningfully expands the test matrix; we want M1 stability before paying that cost.

## Overlay lifecycle

The overlay's lifecycle is driven by the messaging contract (`docs/superpowers/specs/2026-05-08-messaging-contract.md`). Mount and tear-down responsibilities sit entirely in the content script.

- **Mount.** The CS creates the overlay on receipt of `start-read` (Port open frame). It appends a single `<div>` host to `document.body` and calls `attachShadow({ mode: 'closed' })` for host-page CSS isolation. All overlay markup, styles, and listeners live inside the closed shadow root; the host page cannot reach them.
- **Destroy.** The CS removes the host node and disconnects listeners on **any** of: Port `onDisconnect` (popup closed, SW evicted, tab navigation), explicit `stop` frame, Esc keydown inside the shadow root, or close-button activation. Browser-driven destruction (full-page navigation) is fine — no explicit cleanup is required because the document is gone.
- **Second popup-click while open.** The popup observes Port state via the SW (per the messaging contract). If a session Port for the active tab is held, the popup renders the "Reading… [pause / resume / close]" surface from the hi-fi mock; it does NOT re-issue `start-read`. Re-mount is impossible while the existing overlay is mounted.
- **Focus management.** Before mount, the CS records `document.activeElement` on the host page. The shadow root traps Tab / Shift-Tab inside the overlay's focusable controls (play/pause, close, settings shortcut). Esc both closes the overlay and restores focus to the recorded element.
- **Scroll lock.** On mount, the CS sets `document.documentElement.style.overflow = 'hidden'` (preserving the prior value). On destroy, the prior value is restored. The overlay's own scroll affordances live inside the shadow root and are unaffected.

## Out of Scope

- Color palette / theme detail and named-theme tokens (lives with #27 / #28).
- Icon SVG assets and visual design.
- Animation duration / easing curves beyond the `prefers-reduced-motion` switch.
- Font-stack selection and OpenDyslexic toggle logic (#28).
- Document Picture-in-Picture **UX details** — placement of controls, default window size, restore behavior. This spec only commits to the feature flag, capability check, and fallback contract.
- i18n of shortcut hints and control labels.

## Acceptance Criteria

1. At a 320×568 viewport in DevTools device mode, the overlay renders without horizontal scroll, the word region computed font-size is ≥ 2rem, and all control-bar buttons are ≥ 44×44 CSS px.
2. At a 3840×2160 viewport, the reading zone's `max-inline-size` resolves to ≤ 1100 px and the word does not exceed 5.5rem.
3. With browser zoom at 400% on a 1280 px viewport, no element clips, no horizontal scroll appears, the overlay is in `narrow` tier, and all controls remain reachable by Tab.
4. Under `forced-colors: active` (emulated via DevTools Rendering panel), the overlay uses only system color tokens; no fixed `#hex` values render. Axe scan passes with zero contrast violations.
5. With `(pointer: coarse)` emulated, every control-bar button satisfies `getBoundingClientRect()` ≥ 44×44, regardless of container tier.
6. With `prefers-reduced-motion: reduce`, overlay open/close transitions complete in ≤ 1 frame. RSVP cadence at the user-configured WPM is unchanged (verified by tick-interval measurement).
7. With the overlay container resized live from 1200 px → 360 px, the tier switch from `wide` → `narrow` does NOT trigger a layout shift in the active word column (ORP column position stable; verified by `ResizeObserver` snapshot before/after the tick).
8. Axe-core scan against the overlay in all three tiers passes with no `color-contrast` or `target-size` violations.
9. Document-PiP feature flag, when enabled and supported, opens a PiP window and the overlay renders correctly down to a 320 px PiP window width; when unsupported, the toggle is hidden and the in-page overlay path is used.

## Visual reference

Imported in PR for `docs/design-pack-reconciliation` (see `docs/design/RECONCILIATION.md`). Files:

- `docs/design/Speed Reader Hi-Fi.html` — authoritative hi-fi for the in-page reader, including ORP highlight treatment, prev/upcoming-3 context line placement, control bar, and scrim. Corresponds to the `wide` tier (≥ 480 px container).
- `docs/design/screens/popup-hifi.png`, `docs/design/screens/popup-color.png` — the surrounding browser context and how the overlay's popup partner sits next to the page.
- `docs/design/screens/paper-theme.png`, `docs/design/screens/paper-forced.png` — `paper` theme baseline and the forced-colors variant. The forced-colors screen is the visual anchor for §6 `forced-colors: active` behavior in this spec.

**Coverage gap — narrow tier has no mock.** The hi-fi pack is desktop-first. No screen exists at 320–767 px container width. The prose in §1 (Breakpoint philosophy) and §3 (Control-bar adaptation) remains authoritative for the `narrow` tier; do not infer narrow-tier behavior from the `wide` mocks. When narrow-tier visuals land, file under #35 follow-up and update this section.

**Ultra tier (≥ 1280 px)** is also not depicted at 4K dimensions in the pack; the `max-inline-size: min(72ch, 1100px)` cap in §2 is the binding contract regardless.
