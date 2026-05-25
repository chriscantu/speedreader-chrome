# Self-identified weaknesses — issue #74 builder

Written BEFORE implementation per the antagonistic-ring builder protocol. These
are the three weaknesses I expect a critic to flag against my approach. Cutting
critic time is the goal; honest disclosure cuts more time than defensive
framing.

## 1. axe-core under JSDOM cannot evaluate CSS custom properties applied via stylesheet selectors

axe-core's contrast rule works by walking the DOM and computing the effective
`background-color` / `color` of each element. Under JSDOM, `getComputedStyle()`
does NOT resolve CSS custom-property cascades the way a real browser engine
does — `var(--bg)` references typically come back as the literal string
`"var(--bg)"`, not the resolved hex value.

To get axe-core to evaluate contrast at all under JSDOM, the test fixture must
INLINE the resolved colors on each element (`style="background: #ffffff; color:
#202124"`) rather than rely on the applier's `--bg` / `--text` var pipeline.
This means the a11y test verifies **the token VALUES in `THEME_TOKENS`**, not
the applier's wiring. The applier test covers the wiring separately, but the
a11y test is one indirection removed from a real-browser pass. A real-browser
Playwright sweep is the ground truth and is out-of-scope for this PR.

## 2. `forced-colors: active` cannot be exercised faithfully under JSDOM

JSDOM's `window.matchMedia` is a stub that returns `matches: false` for any
query by default. We can monkey-patch `matchMedia` to return `matches: true`
for `(forced-colors: active)` in a test, but the actual browser behavior of
forced-colors (system-color keyword substitution: `Canvas`, `CanvasText`,
`LinkText`, `ButtonFace`, etc.) is NOT simulated. JSDOM does not implement
the system-color keyword resolution that gives forced-colors its semantic
weight.

What this PR's forced-colors test verifies: (a) the applier still writes its
custom-property values when `forced-colors: active` matches — i.e., we do NOT
clobber user-agent tokens by withholding writes — and (b) the documented
CSS-side fallback contract (`@media (forced-colors: active)` selectors that
yield to `Canvas` / `CanvasText`) is exercised at least by reference. What it
does NOT verify: that the visual rendering in a real high-contrast Windows
session matches the design pack. Playwright + a Windows runner with the
high-contrast theme enabled is the only way to verify that, and it is
out-of-scope here.

## 3. Token slot reduction (5 vs Hi-Fi.html's 11) silently drops surface tiers and text variants

The task specifies "5 token slots minimum: `{ bg, surface, text, accent,
accentSoft }`" and `docs/design/Speed Reader Hi-Fi.html` defines 11 tokens
per theme (`--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`,
`--text-2`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`,
`--accent-soft`). I am shipping the minimum 5 only. This is a deliberate
match to the task spec, but it means the overlay component (when it lands in
a later PR) will need to either (a) compute the missing tiers from the base
tokens (e.g., `--surface-2 = color-mix(in oklab, var(--surface) 95%,
var(--text))`); or (b) require a follow-up PR that widens `THEME_TOKENS` to
include the dropped slots.

The risk: if the overlay PR ships without revisiting this, designer-tuned
`--surface-2` / `--surface-3` / `--text-muted` values from the Hi-Fi mock
will be lost, and the surfaces will look algorithmically derived rather than
hand-tuned. This violates ADR #0002's "designer-tuned color is load-bearing"
force. Mitigation: flag this explicitly in the PR body so the overlay PR
opens a follow-up to widen the token map before consuming it.
