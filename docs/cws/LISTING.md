# Chrome Web Store Listing — SpeedReader

This document is the source of truth for the SpeedReader Chrome Web Store
listing copy. Every marketing claim below traces to a shipped feature
(see audit table at the bottom). When a future PR ships a new
user-facing feature, update both this listing AND `CHANGELOG.md` in the
same commit.

---

## Listing fields

| Field | Value |
|---|---|
| Extension name | SpeedReader |
| Category | Accessibility |
| Language | English (en-US) |
| Single-purpose statement | Display the text of the page you are reading using Rapid Serial Visual Presentation (RSVP), so neurodivergent readers can read web articles one word at a time at a controlled pace. |

The single-purpose statement is required by Chrome Web Store policy
([Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/use-of-permissions))
and must describe ONE narrow purpose. Per-permission justifications live
in [`docs/permission-justifications.md`](../permission-justifications.md);
paste them into the Privacy tab's "Permission justification" boxes
verbatim at submission time.

---

## Short description (≤132 characters)

> Free RSVP speed reader for neurodivergent readers. One word at a time, adjustable speed, OpenDyslexic. No tracking.

**Character count: 115 / 132** (verified by counting; see
"Char-count check" section below).

The Chrome Web Store displays this string under the extension name in
search results and the store sidebar. It is hard-capped at 132
characters. Avoid emojis and trailing whitespace.

### Char-count check

Reproducible count via Node:

```bash
node -e 'console.log("Free RSVP speed reader for neurodivergent readers. One word at a time, adjustable speed, OpenDyslexic. No tracking.".length)'
# → 115
```

If you edit the string, re-run the snippet and update the count above.
Do NOT ship if the count exceeds 132.

---

## Detailed description

Paste the block below verbatim into the Chrome Web Store listing's
"Detailed description" field. The store renders plain text with line
breaks; basic Markdown (headings, bold, lists) is NOT rendered, so the
copy below uses ALL-CAPS section headers and bullet dashes for
structure. Keep it under ~16,000 characters (store hard cap).

```
SpeedReader is a free, open-source RSVP speed reader for Chrome. It is
built for neurodivergent readers — people with ADHD, dyslexia, or other
processing differences — who find that traditional left-to-right line
scanning is tiring, and that seeing one word at a time at a controlled
pace is not.

It runs entirely on your device. No accounts. No analytics. No network
calls. No data ever leaves your browser.


WHAT IT DOES

RSVP stands for Rapid Serial Visual Presentation. Instead of asking
your eyes to track across a page of text, SpeedReader shows you the
words of an article one at a time, in a fixed position, at a speed you
control. Your brain still does the reading — it just stops doing the
eye-tracking work on top of it.

When you trigger SpeedReader on a web page, it extracts the article's
main text and replaces the page with a focused overlay. Press Space to
play and pause. Press Esc to close.


WHO IT IS FOR

- Readers with ADHD whose attention drifts on long-form text.
- Readers with dyslexia who pair RSVP with a dyslexia-aware font
  (OpenDyslexic is bundled in the extension).
- Readers with other processing differences who find sequential
  word-by-word presentation less effortful than scanning.
- Anyone who has bounced off a long article and wished it were shorter
  to commit to. RSVP makes the commitment about time, not willpower.

It is also useful to non-neurodivergent readers who want to read at a
higher words-per-minute rate, but the design priorities — large tap
targets, clear typography, minimal cognitive load — are set by the
neurodivergent user.


HOW IT WORKS

1. Open any web article.
2. Click the SpeedReader toolbar icon, or press Ctrl+Shift+Y
   (MacCtrl+Shift+Y on macOS), or right-click selected text and pick
   "SpeedReader".
3. The overlay opens with the first word of the article. Press Space
   to play.
4. Press Space again to pause. While paused, the overlay shows a
   one-line context preview so you can re-orient before resuming.
5. Use the arrow keys to step backward or forward by sentence, or to
   adjust the speed in 10 WPM increments.
6. Press Esc to close. If you reopen the same article in the same
   browser session, SpeedReader resumes from where you stopped.


WHAT YOU CAN ADJUST

- Speed — from 100 to 600 words per minute, in steps of 10.
- Theme — Light, Dark, System, plus Sepia, Paper, Cream, and Nord for
  lower-contrast reading.
- Font — any installed system font, or toggle on the bundled
  OpenDyslexic typeface.
- Font size — independent of the page's CSS, so you can scale the
  reader without scaling the rest of the web.
- Word alignment — Optimal Recognition Point (a focus letter
  highlighted at ~30% of each word) or centered.
- Punctuation pacing — slow down briefly at commas, periods, and
  sentence-ending punctuation for a more natural reading rhythm.
- Show line of context around the current word for additional
  visual anchoring.
- Always start from word one — disable the in-session resume if you
  prefer to start every article from the beginning.


PRIVACY

SpeedReader does not collect, transmit, sell, share, or transfer any
data. There is no server. There is no account. There is no analytics
SDK. There are no network calls beyond Chrome's own update check.

Settings (speed, font, theme) are stored locally via the standard
chrome.storage API. The full privacy policy is published at
https://github.com/chriscantu/speedreader-chrome/blob/main/PRIVACY.md
and is in the repository — anyone can audit the source.


ACCESSIBILITY

This is an accessibility tool first and a productivity tool second.

- Fully responsive — works from ~320 px phones through 4K monitors.
- Keyboard-only operation supported throughout (Space, Esc, arrows).
- Tap targets meet WCAG 2.5.5 on touch surfaces.
- Live regions announce the current word for screen-reader users.
- Reduced-motion preference is respected.
- Works with the bundled OpenDyslexic font, or any font you prefer.


WHY IT EXISTS

SpeedReader was originally built for Safari by a developer with ADHD
and suspected dyslexia who found traditional reading exhausting and
RSVP genuinely helpful. Chrome users with the same needs deserve the
same free, unlocked tool. There is no upsell. There is no premium tier.
There is no plan to add one.


OPEN SOURCE

MIT-licensed. The full source code, design specs, and test suite live
at:

https://github.com/chriscantu/speedreader-chrome

Issues, pull requests, and forks are welcome.
```

Word count (informational, not enforced): ~530.

---

## Promotional copy snippets (reusable)

Pull these into social cards, the marquee tile, or short promo blocks
without re-deriving them.

### Tagline (one line)

> Reading shouldn't be this hard.

### Two-line elevator

> RSVP speed reading for ADHD, dyslexia, and other processing
> differences. Free, open-source, on-device.

### Three-feature summary

- One word at a time, 100–600 WPM
- OpenDyslexic font + 7 themes
- Local-only — no tracking, no network

---

## Claim audit — every marketing claim ↔ shipped reality

Every claim in the descriptions above traces to a shipped artifact in
this repo. If a row's evidence column ever stops being true, REMOVE the
claim from the listing copy in the same PR.

| Claim | Evidence |
|---|---|
| RSVP (one word at a time) | `src/core/rsvp-engine/` |
| Adjustable 100–600 WPM, steps of 10 | `src/chrome/options/index.html` (`min=100 max=600 step=10`) |
| Optimal Recognition Point (ORP) alignment | `src/core/orp/`, `alignment` setting |
| Context preview on pause | `CHANGELOG.md` Unreleased → #20; `src/core/overlay/sentence-context.ts` |
| Punctuation pacing (periods 1.5×, commas 1.2×) | `CHANGELOG.md` Unreleased → #15; `punctuationPacing` setting |
| In-session resume from last word | `CHANGELOG.md` Unreleased → #25 (in-memory; cross-session deferred) |
| Selection-only reading (popup fallback) | `CHANGELOG.md` Unreleased → #18; `src/chrome/popup/index.html` `read-selection` button |
| Right-click "SpeedReader" submenu on selection | `manifest.ts` (`contextMenus`); `docs/permission-justifications.md` |
| OpenDyslexic toggle | `src/chrome/options/index.html` (`#openDyslexic`); `fonts/` web-accessible resource |
| Themes (Light / Dark / System / Sepia / Paper / Cream / Nord) | `src/chrome/options/index.html` (`#theme` `<select>`) |
| Show line of context around current word | `src/chrome/options/index.html` (`#contextLine`) |
| Always start from word one | `src/chrome/options/index.html` (`#startFromWordOne`) |
| Keyboard shortcuts (Space, Esc, arrows, Ctrl+Shift+Y / MacCtrl+Shift+Y) | `src/chrome/manifest.ts` (`commands`); `src/chrome/options/index.html` shortcuts card |
| MV3 service worker, no persistent background | `src/chrome/manifest.ts` (`background.service_worker`) |
| No analytics, no network, local-only | `PRIVACY.md`; manifest has no host permissions in production build |
| Fully responsive ~320 px → 4K | `docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md` constraint; options + overlay media queries |
| Open source / MIT | `LICENSE`; `README.md` |

### Deferred claims — DO NOT INCLUDE

Listing copy MUST NOT claim the following until they ship. If a
reviewer suggests adding them, push back and cite this section.

- Cross-session position memory beyond a single browser session
  (chrome.storage persistence is explicitly deferred — see `CHANGELOG.md`
  #25 "chrome.storage persistence remains deferred").
- Curated 5-font picker (`src/chrome/options/index.html` comment marks
  this as arriving with issue #28).
- Mobile Chrome (Android) support — the responsive overlay is built for
  it, but the Web Store listing should NOT promise Android delivery
  until the extension is verified there.

---

## Submission checklist

Before submitting to the Chrome Web Store:

- [ ] Listing name matches `name` in `src/chrome/manifest.ts` (`SpeedReader`).
- [ ] Short description ≤132 chars; char-count snippet above re-run and matches.
- [ ] Detailed description pasted in WITHOUT Markdown rendering (plain text only).
- [ ] Category: Accessibility.
- [ ] Single-purpose statement pasted into the listing's single-purpose field.
- [ ] Each permission in `manifest.ts` has its justification pasted from
      [`docs/permission-justifications.md`](../permission-justifications.md).
- [ ] Privacy policy URL points at
      `https://github.com/chriscantu/speedreader-chrome/blob/main/PRIVACY.md`.
- [ ] Store icon: `icons/icon128.png` (cited; see screenshot playbook for
      promotional-tile and screenshot dimensions).
- [ ] Screenshots produced per
      [`SCREENSHOT-PLAYBOOK.md`](SCREENSHOT-PLAYBOOK.md) and uploaded.
- [ ] Listing copy audited against the "Claim audit" table above; no
      claim references a not-yet-shipped feature.
