# Chrome Web Store Screenshot Playbook — SpeedReader

This file is the operator's guide for producing the visual assets the
Chrome Web Store listing requires. It is intentionally text-only — image
capture is a separate manual step performed by a human with a browser
and screenshot tool. Every scenario below names the URL, the trigger,
the moment to capture, and the viewport.

> **Asset inventory for issue #43**
>
> | Asset | Dimensions | Source | Status |
> |---|---|---|---|
> | Store icon | 128×128 PNG | `icons/icon128.png` (already in repo) | ✅ Shipped — cite, do not regenerate |
> | Toolbar icons | 16×16, 48×48 PNG | `icons/icon16.png`, `icons/icon48.png` | ✅ Shipped — used by the toolbar, not the store listing |
> | Screenshots | 1280×800 (preferred) or 640×400 | Manual capture — see scenarios below | ⏳ To capture |
> | Promotional tile (small) | 440×280 PNG | Manual design — see promo tile brief | ⏳ To design |
> | Marquee promotional tile | 1400×560 PNG (OPTIONAL) | Manual design — same brief as small tile | ⏳ Optional, defer to post-MVP |
>
> Citation: `icons/icon128.png` exists in the repo root; the Chrome Web
> Store's store icon slot accepts this asset directly. No new
> 128×128 needs to be produced for the initial submission.

---

## Required dimensions and counts (Chrome Web Store rules, 2026)

Per Chrome Web Store documentation
([Marketing your extension](https://developer.chrome.com/docs/webstore/images)):

- **Screenshots:** 1280×800 OR 640×400. **1280×800 is preferred** — it
  renders sharply on the Web Store carousel, which crops 640×400 on
  high-DPI displays. Pick ONE size and use it for every screenshot in
  the set (mixing sizes is allowed but looks inconsistent in the
  carousel).
- **Minimum count:** 1 screenshot.
- **Maximum count:** 5 screenshots.
- **Target for this submission:** 4 screenshots at 1280×800.
- **Promotional tile (small):** 440×280 PNG, JPEG also accepted.
  Required for the Web Store's "featured" eligibility; strongly
  recommended for any listing.
- **Marquee tile:** 1400×560 PNG/JPEG, OPTIONAL. Skip for the initial
  submission — the marquee slot is reserved for editorially-featured
  extensions and is not needed to publish.
- **Store icon:** 128×128 PNG. Already shipped at `icons/icon128.png`.

All screenshots and tiles MUST NOT contain placeholder text, watermarks,
or "coming soon" messaging — Chrome will reject the listing.

---

## Pre-flight — what to install and configure before capturing

The screenshots showcase real extension behavior, not mockups. Set up
once, capture in one sitting.

1. Build the extension from the current branch:

   ```
   npm install
   npm run build
   ```

   This produces `dist/`.

2. Load the extension into a clean Chrome profile:

   - Open `chrome://extensions`
   - Toggle "Developer mode" on
   - Click "Load unpacked"
   - Select the `dist/` directory

   Using a clean profile (Chrome → "Add Person" → "Person 2") avoids
   personal bookmarks, accounts, or other extensions leaking into the
   screenshot frame.

3. Configure the browser for clean captures:

   - Hide the bookmarks bar (`Ctrl+Shift+B` / `Cmd+Shift+B`).
   - Open Chrome DevTools' device toolbar (`Ctrl+Shift+M` /
     `Cmd+Shift+M`) and set the viewport to **1280×800** for desktop
     scenarios.
   - For mobile and tablet variants, use the device toolbar's preset
     dimensions listed below.
   - Disable the OS clock / notification overlays if your capture tool
     records them.

4. Pre-set the extension to a known-good configuration via the options
   page (`chrome-extension://<id>/src/chrome/options/index.html`):

   - WPM: 300
   - Theme: System (capture both light and dark; system follows OS)
   - Font: default (capture OpenDyslexic in scenario 4 specifically)
   - Font size: 64 px
   - Alignment: Optimal Recognition Point
   - OpenDyslexic: off (toggled on in scenario 4)
   - Context line: on
   - Punctuation pacing: on
   - Start from word one: on (avoids in-session position bleed between captures)

---

## Screenshot scenarios

Capture in this order. Each scenario produces ONE final image.

### Scenario 1 — Reader overlay in light theme (the hero shot)

**Why this matters:** The carousel's first frame is the highest-impact
slot. It must communicate "RSVP reader on a real article" in under a
second.

**Setup:**

- OS appearance: light mode (so the System theme picks light).
- Viewport: 1280×800 desktop.
- Article: a public domain or permissively-licensed long-form article.
  Recommended candidates:
  - Wikipedia article — `https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation`
    (meta-relevant; explains the technique the extension uses)
  - Project Gutenberg "Pride and Prejudice" chapter 1 —
    `https://www.gutenberg.org/files/1342/1342-h/1342-h.htm#link2HCH0001`
- Avoid: paywalled sites, sites with logos that imply endorsement, news
  homepages with breaking-news strips, anything political.

**Trigger:**

1. Open the article in a fresh tab.
2. Click the SpeedReader toolbar icon → "Read article".
3. Wait for the overlay to render the first word.
4. Press Space to start playback.
5. Let the reader run to roughly the 10th–15th word of the second
   paragraph (avoids the opening word, which is often a single
   character like "A" or "I").
6. Press Space to pause — the context-preview line appears, which is
   the feature this screenshot is intended to showcase.

**Capture:** The full browser viewport, with the overlay centered, the
focal word visible with its ORP letter highlighted, and the
context-preview line beneath. Crop the browser chrome (URL bar) IN —
the URL signals "this is a real web page" to reviewers.

**Filename suggestion:** `screenshots/01-reader-light-context-preview.png`

---

### Scenario 2 — Reader overlay in dark theme

**Why this matters:** Demonstrates the Dark theme and reassures users
who default to dark mode.

**Setup:**

- OS appearance: dark mode (or set the extension theme explicitly to
  Dark in options).
- Viewport: 1280×800 desktop.
- Article: same as scenario 1 OR a different public-domain article so
  the carousel doesn't feel repetitive. The Project Gutenberg
  candidates above all qualify.

**Trigger:**

1. Confirm the options page shows Theme = Dark (or System with OS in
   dark mode).
2. Activate via the keyboard shortcut: `Ctrl+Shift+Y` on Windows/Linux,
   `MacCtrl+Shift+Y` on macOS (literal Control, not Cmd).
3. Press Space, run to about word 20, press Space to pause.

**Capture:** Full viewport. The dark overlay against a dark page should
show the focal word legibly; if contrast looks borderline, increase
font size to 72 px just for this capture.

**Filename suggestion:** `screenshots/02-reader-dark-keyboard.png`

---

### Scenario 3 — Selection-only reading from the popup

**Why this matters:** Documents the "Read selection" fallback path —
critical for users on SPAs and paywalled pages where auto-extraction
misses the intended text.

**Setup:**

- Viewport: 1280×800 desktop.
- Page: any page with a clearly readable block of text. A
  documentation page (e.g., MDN's article on Reader Mode) works well
  because the selection contrast is high.

**Trigger:**

1. Select a paragraph of text by click-dragging across it.
2. Click the SpeedReader toolbar icon to open the popup.
3. With text selected, the popup's "Read selection" button becomes
   enabled (the disabled state is the default per
   `src/chrome/popup/index.html`).

**Capture:** Full viewport with the popup open, the highlighted text
selection visible behind it, and the "Read selection" button visibly
enabled. The popup itself should be in focus.

**Filename suggestion:** `screenshots/03-popup-read-selection.png`

---

### Scenario 4 — OpenDyslexic font + options page

**Why this matters:** Calls out the dyslexia-aware typeface that
distinguishes SpeedReader from generic speed readers, and shows the
options surface so users know they can customize.

**Setup:**

- Viewport: 1280×800 desktop.
- Article: same as scenario 1, OR open the options page directly via
  `chrome://extensions` → SpeedReader → "Extension options". The
  options page works as a stand-alone capture.

**Trigger:**

1. Open the options page.
2. Toggle "Use OpenDyslexic font" ON.
3. (Optional split-screen variant:) open a tab with an article,
   activate the reader, let it run a few words so the OpenDyslexic
   rendering shows in the overlay, then capture both the article
   reader overlay AND a fragment of the options page if your screenshot
   tool supports it. A simpler shot of just the options page with the
   toggle ON is acceptable.

**Capture:** Full viewport. Make sure the "Use OpenDyslexic font"
checkbox is visibly checked. The options page's "Shortcuts" card is
ALSO worth including in the frame — it doubles as documentation in the
listing image set.

**Filename suggestion:** `screenshots/04-options-opendyslexic.png`

---

### Optional Scenario 5 — Right-click context menu activation

**Why this matters:** Showcases the context-menu integration. Optional
because the carousel maxes at 5 — include this only if the prior 4 came
out clean.

**Setup:**

- Viewport: 1280×800 desktop.
- Page: any article. Select a sentence.

**Trigger:**

1. Select text.
2. Right-click.
3. Hover the "SpeedReader" submenu — its presets (reading speed,
   start-from-word-one, show-context-line) expand to the right.

**Capture:** Full viewport with the open context menu and the
SpeedReader submenu expanded. The screenshot tool may need to be
configured to capture the menu (macOS Preview's "Capture from Menu"
mode, or Windows snipping tool's "Window snip" delay).

**Filename suggestion:** `screenshots/05-context-menu.png`

---

## Viewport coverage list

Capture scenarios 1 and 2 at multiple viewports to demonstrate
responsiveness. The Web Store accepts ONE viewport in the screenshot
slot (1280×800 or 640×400) — but the README and project site can host
the full responsive set, and reviewers sometimes ask for them.

| Viewport label | Dimensions | Use |
|---|---|---|
| Desktop (default) | 1920×1080, captured at 1280×800 | Carousel scenarios 1–4 |
| Tablet | 1024×768 (iPad portrait) | Repo / blog gallery only |
| Mobile | 390×844 (iPhone 13 portrait) | Repo / blog gallery only |
| Phone floor | 320×568 (smallest supported per CLAUDE.md) | Internal QA only |

The mobile and tablet captures are NOT for the Web Store carousel —
1280×800 is what the carousel expects, and shrinking a mobile capture
to fit looks broken. Use mobile/tablet captures for the GitHub README,
project landing page, or social posts.

---

## Promotional tile (440×280) brief

The small promotional tile is a hand-designed image; do NOT screenshot
it. Spec for the designer (or the maintainer's first pass):

- **Dimensions:** exactly 440×280 px, exported as PNG (or JPEG, but PNG
  preferred for the dark theme).
- **Composition (recommended):**
  - Left two-thirds: a stylized representation of the RSVP overlay — a
    single word at large size with a single letter highlighted in
    accent color (representing the ORP focus point).
  - Right one-third: the SpeedReader wordmark stacked above the tagline
    "Reading shouldn't be this hard."
- **Color:** match the extension's default Dark theme — dark background
  (~#1f1f1f), accent color matching the ORP highlight currently used
  in the overlay (check `src/core/overlay/styles.ts` or the theme
  applier for the exact hex). The promotional tile is the first
  contact most users have; consistent branding with the actual
  in-extension theme reduces install-vs-experience cognitive
  dissonance.
- **Typography:** if the maintainer has license to redistribute
  OpenDyslexic (the extension does — see `fonts/`), using OpenDyslexic
  for the word in the left two-thirds doubles as a feature ad.
  Otherwise, use a clean sans-serif (Inter, Source Sans 3).
- **Required:** include the word "SpeedReader" somewhere on the tile.
- **Forbidden by store policy:**
  - No "Free", "Get it now", "Download", or other call-to-action
    overlays.
  - No competitor names or logos.
  - No screenshots of other browsers' chrome.
  - No misleading badges (e.g., a fake "5-star" rating graphic).

**Filename suggestion:** `assets/promo/promo-tile-440x280.png`

---

## Filename and directory convention

Save final captures and tiles under `assets/` at the repo root (NOT
under `docs/cws/` — `docs/` is text-only). Suggested layout:

```
assets/
  screenshots/
    01-reader-light-context-preview.png
    02-reader-dark-keyboard.png
    03-popup-read-selection.png
    04-options-opendyslexic.png
    05-context-menu.png            # optional
  promo/
    promo-tile-440x280.png
```

This directory does NOT yet exist; the human capturing the screenshots
creates it. Track the captures in a single follow-up PR titled
"Add Chrome Web Store screenshots and promo tile" so the listing-text
PR (this one) merges cleanly without blocking on image production.

---

## Post-capture QA

Before uploading to the Web Store:

- [ ] Every screenshot is EXACTLY 1280×800 (verify with `file` or
      `identify` from ImageMagick).
- [ ] No personal data visible — usernames, email addresses, bookmarks
      bar, other extensions' icons.
- [ ] No "Developer mode" banner across the top of Chrome (toggle off
      Developer mode in the capture profile, or crop above the banner).
- [ ] Promotional tile is exactly 440×280.
- [ ] All captures use the same Chrome theme (light or dark) across
      a scenario, so the carousel reads as a coherent set.
- [ ] No copyrighted article body that the maintainer doesn't have
      rights to display — public domain (Project Gutenberg) or
      CC-licensed (Wikipedia) only.
- [ ] Re-read [`LISTING.md`](LISTING.md)'s "Claim audit" table — every
      feature you showed in a screenshot is one the listing copy claims
      and the codebase ships.
