# Design Pack Reconciliation

**Date:** 2026-05-08
**Status:** Reconciliation pass (PR open, not merged)
**Inputs:** `docs/design/Speed Reader Hi-Fi.html`, `docs/design/Speed Reader Wireframes.html`, `docs/design/Popup Wireframes.html`, `docs/design/screens/*.png`
**Outputs:** Spec amendments (this PR), new GitHub issues (filed), sequencing implications (below).

---

## What was imported

- **`Speed Reader Hi-Fi.html`** — authoritative hi-fi mock. 5 surfaces (in-page reader, toolbar popup, context menu, options, onboarding), 6 named themes (`light`, `dark`, `sepia`, `paper`, `cream`, `nord`), Roboto / Roboto Mono / Source Serif 4 type stack.
- **`Speed Reader Wireframes.html`, `Popup Wireframes.html`** — earlier-fidelity references; superseded by the hi-fi where they conflict.
- **`screens/*.png`** — 14 rendered screens, including `popup-hifi.png`, `popup-color.png`, `paper-theme.png`, `paper-forced.png` (forced-colors variant), and the `ctx-*` context-menu flow screens.

## Surface ↔ issue mapping

| Surface (Hi-Fi nav) | Existing issue(s)                                                                                   | New issue                                              | Notes                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 In-page reader   | #19 (overlay layout), #20 (context preview), #21 (overlay chrome), #35 (responsive overlay)         | —                                                      | Mock confirms ORP highlight, prev/next-3 context line, control bar, scrim.                                                                                                                                                                                       |
| 02 Toolbar popup    | #6 (popup scaffold)                                                                                 | **NEW** popup pre-action word count (architecture pin) | Mock shows `Read this page · 3,842 words · ~9 min` BEFORE click; "RECENT" list with progress bars and "12 saved" count.                                                                                                                                          |
| 03 Context menu     | #18 (text-selection fallback) — partial overlap                                                     | **NEW** context-menu integration                       | Hi-fi shows native `chrome.contextMenus` entry with last-used speed submenu + scoped mini-modal. Richer than #18; #18 stays as the popup-side "Read selection" path.                                                                                             |
| 04 Options page     | #30 (options page UI), #26 (themes), #27 (OpenDyslexic), #28 (font picker), #29 (font-size stepper) | **NEW** theme expansion (3 → 6)                        | Mock exposes `chunk size`, `focus marker (line/bold/underline)`, `accent color swatches`, `slow down long words`, `only on selection` — none in current `SettingsSchemaV1`. Most are M2 (#51, #50) but settings schema spec needs to acknowledge the v2 surface. |
| 05 Onboarding       | —                                                                                                   | **NEW** onboarding (welcome + WPM calibration)         | Net-new surface. 2 screens in hi-fi: welcome + calibrate.                                                                                                                                                                                                        |

## Spec deltas (mocks vs prose)

1. **Themes — 6, not 3.** `Speed Reader Hi-Fi.html` defines `[data-theme]` selectors for `dark`, `sepia`, `paper`, `cream`, `nord` plus a default (`light`). Verified by `grep -oE '\[data-theme="[^"]+"\]' Speed\ Reader\ Hi-Fi.html | sort -u` → 5 explicit + 1 default = 6. The settings spec enum was `['light', 'dark', 'system']`. Per parity-as-floor-not-ceiling. Resolution: amend `SettingsSchemaV1.theme` enum; fold #50 into theming surface.
2. **Popup needs word count pre-action.** The CTA in the mock reads `Read this page · 3,842 words · ~9 min` **before** the user clicks. This implies extraction (#17) runs lazily on popup-open, not proactively on page load. The article-extraction spec did not pin trigger timing. Lazy-on-popup-open is the right answer (no per-page cost on uninvited tabs). Spec amended to state this.
3. **Recent / saved in the popup.** Mock shows `RECENT` list with three items, per-item progress bars, and a `12 saved` chip. Maps to #48 (reading-position memory, M2) + #49 (reading history, M2) + #53 (saved articles, M3). The mock is **aspirational** — M1 popup ships the CTA and the alt buttons (`Paste text`, `From URL`) only. Document this rather than pulling four issues forward; M1 still ships.
4. **Options page is wider than current settings schema.** `chunk size 1/2/3` (= #51, M2), `focus marker line/bold/underline` (no existing issue — visual treatment of ORP, post-M1), `accent color swatches` (no existing issue, post-M1), `slow down long words` (no existing issue, post-M1), `auto-detect articles` and `only on selection` toggles (extraction behavior). M1 settings schema stays as-is; v2 migration handles the expansion. Settings spec acknowledges the v2 surface.
5. **Onboarding (05) — net-new.** Welcome screen + WPM calibration screen. No existing issue. Filed.
6. **Context menu (03) — richer than #18.** Mock shows native chrome submenu with last-used-speed and a scoped mini-modal that toggles "selection / full article" with a one-click "← Full article" expand. #18 currently scopes to "popup button when extraction insufficient." Filed a new issue; #18 stays for the popup-side fallback path.
7. **Responsive coverage gap.** Hi-Fi is desktop-only. No mock at 320–767 px tier. Responsive overlay spec (#35) prose remains authoritative for `narrow`. Amendment notes this explicitly.

## Implications for in-flight work

- **#19 overlay layout** — engineer has not started; hold until this PR merges so the visual reference is in place.
- **#26 themes** — scope expands from 3 to 6 themes. Filed dedicated issue (theme expansion) so #26 stays focused on `light/dark/system` as the baseline triplet and the new issue tracks the additional palettes + accessibility-test surface.
- **#17 article extraction** — spec amended: extraction triggers lazily on popup-open, not on page load.
- **#48 / #49 / #53** — milestones unchanged. Mock state is aspirational for the popup; M1 popup is reduced to the CTA + alt actions. Tracked as a documentation note, not a milestone move.
- **#50 background-color customization** — overlaps with the theme expansion. Recommend folding the M2 work into the new theme-expansion issue and closing #50 as duplicate at M2 planning time, NOT now.

## What's NOT mocked yet

Naming gaps so they don't go silent:

- Mobile / narrow viewports (< 768 px) — no hi-fi.
- Options page sub-pages (`Shortcuts`, `Sites`, `About` tabs visible but empty in the mock).
- Accessibility states beyond `paper-forced.png` — no focus-ring spec, no `prefers-contrast: more` variant, no `prefers-reduced-motion` chrome-transition variant.
- Error states — extraction failure UI in the popup, restricted-page state, paywall-suspected, "no article found" fallback CTA. Spec text exists (#17); no visual.
- Loading / extracting states — popup before word count resolves.
- Long-article edge case — what does `~9 min` look like at `~120 min`?
