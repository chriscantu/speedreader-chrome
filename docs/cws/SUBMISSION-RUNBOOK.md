# Chrome Web Store — Submission Runbook

> **Audience:** the maintainer performing the actual Chrome Web Store
> submission. This runbook is a step-by-step checklist; agents cannot
> submit on the maintainer's behalf.
>
> **Scope:** the first SpeedReader for Chrome release. Subsequent
> releases should follow §6 (Post-submission) plus a thinner version
> of §2 (Build) and §4 (Upload).
>
> **Issue:** [#46](https://github.com/chriscantu/speedreader-chrome/issues/46)

---

## At a glance

```
1. Pre-flight checklist        →  every dep merged, screenshots/promo on disk
2. Build steps                 →  npm ci && npm run build && zip dist/
3. Developer account           →  console signup, $5 fee, 2FA
4. Upload + listing entry      →  field-by-field map → CWS form
5. Reviewer-feedback template  →  canned responses for common rejections
6. Post-submission             →  git tag, GitHub release
```

If any §1 box is unchecked, stop and resolve the dependency before
building. The CWS form is unforgiving about partial submissions.

---

## 1. Pre-flight checklist

Run these checks from the repository root **before** starting the
build. Each item links to the dependency that supplies it.

### 1.1. Dependency files present on disk

| File                                | Required for                                                                 | Status check                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PRIVACY.md`                        | Privacy practices section of the listing                                     | `ls PRIVACY.md` — must exist; closed by [#44](https://github.com/chriscantu/speedreader-chrome/issues/44) |
| `LISTING.md`                        | Store-listing copy (name, summary, description, single-purpose statement)    | `ls LISTING.md` — required by [#43](https://github.com/chriscantu/speedreader-chrome/issues/43)           |
| `PERMISSIONS.md`                    | Permission + host-permission justifications                                  | `ls PERMISSIONS.md` — required by [#45](https://github.com/chriscantu/speedreader-chrome/issues/45)       |
| `docs/permission-justifications.md` | Source-of-truth for per-permission rationale (precursor to `PERMISSIONS.md`) | `ls docs/permission-justifications.md` — already shipped                                                  |
| `CHANGELOG.md`                      | Release notes; SHA-256 of the zip recorded here                              | `ls CHANGELOG.md` — already shipped                                                                       |

If `LISTING.md` or `PERMISSIONS.md` is missing, the runbook cannot
proceed. They are the canonical text the maintainer copies into the
CWS form fields; without them the submission will either lose the
text on the next edit or drift from the documented justification.

### 1.2. Store assets captured

The CWS form requires uploaded images for store icon, screenshots,
and a small promotional tile. Capture these per the screenshots /
promo-tile playbook follow-ups to [#43](https://github.com/chriscantu/speedreader-chrome/issues/43).

| Asset                   | Required size(s)                        | Source                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------ |
| Store icon              | 128×128 PNG                             | `icons/icon128.png` (already shipped)            |
| Screenshots             | 1280×800 or 640×400 PNG/JPEG, 1–5 total | Captured per #43 follow-up                       |
| Small promotional tile  | 440×280 PNG/JPEG                        | Captured per #43 follow-up                       |
| (Optional) Marquee tile | 1400×560 PNG/JPEG                       | Skip for v0.1.0 unless featured slot is targeted |

**At least one screenshot is mandatory.** The submission will fail
without it. Five screenshots produce the best store listing — aim for
this even on the first submission.

### 1.3. Version + changelog

The version in `package.json`, `src/chrome/manifest.ts`, and the
release entry in `CHANGELOG.md` MUST agree. The repo currently sits
at **`0.1.0`** in both `package.json` and `src/chrome/manifest.ts`;
the runbook assumes the first submission ships at `0.1.0` unless a
deliberate bump precedes it.

Pre-flight steps:

1. Read the version from `package.json` (currently `0.1.0`).
2. Confirm `src/chrome/manifest.ts` matches (`version: '0.1.0'`).
3. Promote the `## [Unreleased]` block in `CHANGELOG.md` to a dated
   `## [0.1.0] — YYYY-MM-DD` block. Open a fresh empty
   `## [Unreleased]` above it. Update the compare-link footer.
4. Leave a placeholder for the zip SHA-256 — it will be filled in at
   §2.5 after the zip exists.

If the maintainer wants to bump (`0.1.0` → `1.0.0` for the first
public release, etc.), update both files in the same commit and
mirror the heading in `CHANGELOG.md`.

### 1.4. Pre-flight gate

All of the following must be true before continuing:

- [ ] `PRIVACY.md` present
- [ ] `LISTING.md` present
- [ ] `PERMISSIONS.md` present
- [ ] At least one screenshot at 1280×800 captured
- [ ] Promo tile at 440×280 captured
- [ ] `package.json` version matches `src/chrome/manifest.ts`
- [ ] `CHANGELOG.md` has a dated heading for this version (SHA-256
      placeholder is OK at this step)

---

## 2. Build steps

### 2.1. Clean install

```bash
npm ci
```

Use `npm ci` (not `npm install`) — it installs exactly what
`package-lock.json` pins, with no drift. The CWS reviewer compares
the source bundle against the production bundle; a drifted dep tree
makes their job harder and ours.

### 2.2. Run the full pre-push gate

Per the global rule "Run full CI locally before push":

```bash
npm run lint && npm run format:check && npm test -- --run && npm run build
```

All four must pass. The `build` step ends in a `dist/` directory.

### 2.3. Verify `dist/manifest.json` matches the expected MV3 shape

```bash
cat dist/manifest.json
```

Confirm:

- `"manifest_version": 3`
- `"name": "SpeedReader"`
- `"version"` matches `package.json`
- `"permissions"` contains exactly `["storage", "activeTab", "scripting", "contextMenus"]`
- **No top-level `host_permissions` key** (production build omits
  this — only the `SPEEDREADER_E2E=1` build adds `<all_urls>`)
- `"background"` is a service worker module
- `"action"`, `"options_page"`, `"icons"` all present

If a `host_permissions` field appears in the production
`dist/manifest.json`, the build was contaminated by
`SPEEDREADER_E2E=1` — start over with a clean shell.

### 2.4. Create the upload zip

Chrome Web Store expects a zip whose **root** is the contents of
`dist/` — NOT a zip containing a `dist/` directory.

```bash
cd dist
zip -r ../speedreader-chrome-v0.1.0.zip .
cd ..
```

Verify the zip layout:

```bash
unzip -l speedreader-chrome-v0.1.0.zip | head -20
```

The first entries should be `manifest.json`, `service-worker-loader.js`,
`icons/`, `assets/`, etc. **The zip must NOT contain a `dist/` root
directory.**

### 2.5. Record the zip SHA-256

```bash
shasum -a 256 speedreader-chrome-v0.1.0.zip
```

Paste the digest into the `## [0.1.0]` release block in
`CHANGELOG.md` so anyone can verify the exact artifact that landed in
the store:

```markdown
## [0.1.0] — YYYY-MM-DD

**Artifact:** `speedreader-chrome-v0.1.0.zip`
**SHA-256:** `<digest>`
```

Commit `CHANGELOG.md` with the digest before submitting. The store
upload itself happens outside git; the digest is the only on-disk
proof of what was submitted.

---

## 3. Developer account

One-time setup only. Skip this section on repeat submissions.

1. Visit <https://chrome.google.com/webstore/devconsole>.
2. Sign in with the Google account that will own the SpeedReader
   listing. Use a dedicated account (not a personal Gmail) if the
   extension is owned by an organization — ownership transfer later
   is painful.
3. Pay the one-time **$5 USD** developer registration fee. Required
   before any item can be published.
4. Enable two-factor authentication on the account. Required by
   Google for publisher accounts.
5. Complete the publisher identity / contact-email step. The contact
   email is publicly visible on the store listing.

---

## 4. Upload + listing entry

Open the developer console, click **Add new item**, and upload
`speedreader-chrome-v0.1.0.zip`. After upload, the console opens the
listing editor — fill in each field as below.

### 4.1. Package

The zip from §2.4. Nothing else needed.

### 4.2. Store listing tab

| Field                      | Value source                     | Notes                                         |
| -------------------------- | -------------------------------- | --------------------------------------------- |
| **Item name**              | `LISTING.md` → item-name field   | Limit: 75 chars                               |
| **Summary**                | `LISTING.md` → summary field     | **Hard limit: 132 chars**                     |
| **Description**            | `LISTING.md` → description field | Limit: 16,000 chars; plain text               |
| **Category**               | `Accessibility`                  | First-class match for SpeedReader             |
| **Language**               | `English` (primary)              | Translations deferred                         |
| **Store icon**             | `icons/icon128.png`              | 128×128 PNG                                   |
| **Screenshots**            | From §1.2 capture                | 1–5 images, 1280×800 preferred                |
| **Small promotional tile** | From §1.2 capture                | 440×280                                       |
| **Marquee tile**           | Skip                             | Only required for featured-slot consideration |

### 4.3. Privacy practices tab

This tab is where reviewer-rejection risk concentrates. Answer every
question from `PRIVACY.md` — do not improvise.

| Question                                                                                           | Answer                                                                                                                                                                                 | Source                                                                            |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Single purpose**                                                                                 | RSVP (Rapid Serial Visual Presentation) reading for any page the user chooses to read with the extension                                                                               | `LISTING.md` → single-purpose statement                                           |
| **What user data is collected?**                                                                   | None                                                                                                                                                                                   | `PRIVACY.md` → "What we collect: Nothing."                                        |
| **Personally identifiable information**                                                            | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Health information**                                                                             | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Financial / payment information**                                                                | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Authentication information**                                                                     | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Personal communications**                                                                        | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Location**                                                                                       | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Web history**                                                                                    | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **User activity**                                                                                  | Not collected                                                                                                                                                                          | `PRIVACY.md`                                                                      |
| **Website content**                                                                                | Read in-memory only when the user activates the reader; not transmitted, not stored, not shared                                                                                        | `PRIVACY.md` — page text is read into the RSVP engine but never leaves the device |
| **Are you remotely hosting code?**                                                                 | **No**                                                                                                                                                                                 | Bundle ships all code; service worker loads nothing from a remote URL             |
| **Are you using or transferring user data for purposes unrelated to the single purpose?**          | No                                                                                                                                                                                     | `PRIVACY.md`                                                                      |
| **Are you using or transferring user data to determine creditworthiness or for lending purposes?** | No                                                                                                                                                                                     | `PRIVACY.md`                                                                      |
| **Privacy policy URL**                                                                             | The published URL where `PRIVACY.md` is reachable (e.g. `https://github.com/chriscantu/speedreader-chrome/blob/main/PRIVACY.md`)                                                       | The CWS form requires a public URL, not the markdown text                         |
| **Permission justifications**                                                                      | One paragraph per permission, copied from `PERMISSIONS.md`                                                                                                                             | See §4.4                                                                          |
| **Host permission justification**                                                                  | Production build has none — state explicitly that the lazy-injection model uses `activeTab` and `chrome.scripting.executeScript` on user gesture, so no host permissions are requested | See §4.4                                                                          |

### 4.4. Permission + host-permission justifications

Copy each justification verbatim from `PERMISSIONS.md` into the
corresponding text box. The store form has a separate box per
permission — paste one block per box.

Mapping (current `manifest.ts` permission list → CWS form):

| Permission     | Source paragraph                          |
| -------------- | ----------------------------------------- |
| `storage`      | `PERMISSIONS.md` → `storage` section      |
| `activeTab`    | `PERMISSIONS.md` → `activeTab` section    |
| `scripting`    | `PERMISSIONS.md` → `scripting` section    |
| `contextMenus` | `PERMISSIONS.md` → `contextMenus` section |

**Host permissions.** The production build has no `host_permissions`
field (verified in §2.3). In the host-permissions justification box,
paste the explanation from `PERMISSIONS.md` — short version:

> SpeedReader does not request host permissions. The extension uses
> `activeTab` plus `chrome.scripting.executeScript` to inject the
> content script on demand after a user gesture (clicking the popup
> or invoking the keyboard shortcut). This grants temporary access to
> exactly the tab the user asked us to read — nothing more.

### 4.5. Distribution tab

| Field                    | Value                                       |
| ------------------------ | ------------------------------------------- |
| **Visibility**           | Public                                      |
| **Distribution regions** | All regions (no export-control flags apply) |
| **Pricing**              | Free                                        |
| **Mature content**       | No                                          |

### 4.6. Submit for review

Click **Submit for review**. Initial reviews typically take 1–7 days
for a Manifest V3 extension with no host permissions. Single-purpose
ambiguity or unjustified permissions extend the timeline.

---

## 5. Reviewer-feedback template

If the review comes back with a request for clarification or a
rejection, respond promptly. Canned responses for the common
SpeedReader-shaped rejections:

### 5.1. "Broad host permissions are not justified"

This should not fire on the v0.1.0 submission because the production
manifest declares **no** `host_permissions`. If the reviewer flags
this anyway, they are likely looking at `activeTab`. Response:

> SpeedReader does not request `host_permissions` in this submission
> (please see the manifest in the uploaded package — only `storage`,
> `activeTab`, `scripting`, and `contextMenus` are present). The
> extension relies on `activeTab` to grant temporary, user-gesture-
> scoped access to the currently active tab when the user clicks the
> popup or invokes the keyboard shortcut. The content script is
> injected on demand via `chrome.scripting.executeScript`, never on
> page load. The full architecture is documented in our [lazy
> injection ADR](https://github.com/chriscantu/speedreader-chrome/blob/main/docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md).

### 5.2. "Single-purpose statement is unclear"

Response (anchor in `LISTING.md` single-purpose statement):

> SpeedReader's single purpose is **RSVP (Rapid Serial Visual
> Presentation) reading** for any web page the user chooses to read
> with the extension. RSVP displays words sequentially at a
> user-controlled rate to support focused, distraction-free reading,
> particularly for neurodivergent readers (ADHD, dyslexia, processing
> differences). Every code path in the extension — extraction,
> overlay rendering, transport controls, settings — serves this
> single reading mode. The full description is in our store-listing
> copy and in `LISTING.md` in the repository.

### 5.3. "`scripting` permission is not adequately justified"

Response (anchor in `PERMISSIONS.md` → `scripting` section):

> `scripting` is required by the lazy-injection model. The service
> worker calls `chrome.scripting.executeScript` to inject the content
> script into the active tab **after** the user explicitly activates
> the reader (popup click or keyboard shortcut). This avoids
> registering a `content_scripts` entry, which would impose per-tab
> CPU cost on every page the user never invokes SpeedReader on. The
> full per-permission justification is in
> `docs/permission-justifications.md` in the repository.

### 5.4. "`contextMenus` permission is not adequately justified"

Response (anchor in `PERMISSIONS.md` → `contextMenus` section):

> `contextMenus` registers a single right-click menu item, "Read
> selection with SpeedReader", which appears only when the user has
> selected text. Activating it triggers the same RSVP overlay used by
> the popup. This is part of the single-purpose reading flow — it
> provides a user-gesture entry point on pages where the standard
> extraction does not capture the user's intended text.

### 5.5. "Privacy policy is missing or inaccessible"

Response:

> The privacy policy is `PRIVACY.md` at the repository root and is
> linked from the listing's Privacy practices tab. Public URL:
> `https://github.com/chriscantu/speedreader-chrome/blob/main/PRIVACY.md`.
> The policy declares no data collection, no analytics, no telemetry,
> and no network calls. The extension makes no outbound HTTP requests.

### 5.6. Generic rejection without a specific reason

Reply asking for specifics. Do NOT guess at remediations — Google's
review responses are sometimes terse, and modifying the bundle
without a stated reason wastes a review cycle. Template:

> Thank you for the review. We would like to address this rejection
> but the response does not identify the specific policy or
> manifest field at issue. Could you point us at the exact policy
> section or permission your team would like clarified? We will
> respond with the relevant repository link and, if needed, an
> updated bundle.

---

## 6. Post-submission

After the store accepts the submission (whether approved on the
first pass or after revisions), close the loop in git.

### 6.1. Tag the release

The version that shipped to the store is the canonical history
anchor. Tag it on `main` only after the listing is live OR after the
zip has been uploaded and is in review — never before the zip is
final, because the SHA-256 in `CHANGELOG.md` is part of the tagged
commit.

```bash
git checkout main
git pull origin main
git tag -a v0.1.0 -m "SpeedReader for Chrome v0.1.0 — first Chrome Web Store submission"
git push origin v0.1.0
```

### 6.2. Create a GitHub release

From <https://github.com/chriscantu/speedreader-chrome/releases/new>:

- **Tag**: `v0.1.0`
- **Title**: `v0.1.0 — first Chrome Web Store submission`
- **Notes**: copy the `## [0.1.0]` block from `CHANGELOG.md`, including
  the SHA-256.
- **Attach**: `speedreader-chrome-v0.1.0.zip` (the same artifact that
  was uploaded to the store).
- **Mark as latest**.

Attaching the same zip to the GitHub release lets reviewers,
downstream packagers, and future maintainers retrieve the exact
artifact that landed in the store without an account.

### 6.3. Close the issue

Close [#46](https://github.com/chriscantu/speedreader-chrome/issues/46)
with a comment that links:

- The CWS listing URL (once approved).
- The GitHub release URL.
- The CHANGELOG entry.

### 6.4. If the submission was rejected

Do not close [#46](https://github.com/chriscantu/speedreader-chrome/issues/46).
Document the rejection text in the issue, link the §5 response that
was used, and reopen for the next submission cycle. Bump the patch
version (`0.1.0` → `0.1.1`) only if a code change was required to
address the rejection — not for resubmissions of an unchanged
bundle.

---

## Appendix A — Field-by-field copy-paste map

For maintainers who want a flat list to work through:

```
Item name           → LISTING.md → item-name
Summary             → LISTING.md → summary (≤132 chars)
Description         → LISTING.md → description
Category            → Accessibility
Language            → English
Store icon          → icons/icon128.png
Screenshots         → captured per #43 follow-up
Promo tile (small)  → captured per #43 follow-up
Single purpose      → LISTING.md → single-purpose statement
Privacy URL         → public URL of PRIVACY.md on main
Data collected      → None (per PRIVACY.md)
Remote code         → No (bundle is self-contained)
`storage` justif.   → PERMISSIONS.md → storage section
`activeTab` justif. → PERMISSIONS.md → activeTab section
`scripting` justif. → PERMISSIONS.md → scripting section
`contextMenus`      → PERMISSIONS.md → contextMenus section
Host permissions    → none requested; explain lazy-injection
Visibility          → Public
Regions             → All
Pricing             → Free
Mature content      → No
```

## Appendix B — Verification commands quick reference

```bash
# Pre-flight
ls PRIVACY.md LISTING.md PERMISSIONS.md CHANGELOG.md

# Build gate (all four must pass)
npm run lint
npm run format:check
npm test -- --run
npm run build

# Manifest shape check
cat dist/manifest.json

# Zip + digest
cd dist && zip -r ../speedreader-chrome-v0.1.0.zip . && cd ..
shasum -a 256 speedreader-chrome-v0.1.0.zip
unzip -l speedreader-chrome-v0.1.0.zip | head -20

# Post-submission
git tag -a v0.1.0 -m "..."
git push origin v0.1.0
```
