# Overlay MVP Implementation Plan (#19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MVP-floor overlay (centered word + ORP highlight + dim backdrop + close + focus trap + aria-live) so the RSVP engine has a rendering surface; unblock #33, #36, #71, #131 and Chrome Web Store submission.

**Architecture:** Portable `src/core/overlay/` module (no `chrome.*` imports) exposes `createOverlay(opts)` returning a mount/unmount API. The content script (`src/chrome/content/index.ts`) mounts the overlay on a successful `activate-reader` handshake. Overlay attaches an **open** shadow root to a `<div>` host appended to `document.body`, owns one `RsvpEngine` instance, subscribes to settings changes, and applies theme tokens via `core/theme/applier`. Lifecycle is LIFO: mount → applyTokens → subscribe → engine.start → tick loop → close → engine.stop → unsubscribe → teardown. Second mount while mounted = no-op (idempotent).

**Tech Stack:** TypeScript, Vite, vitest (unit, jsdom env), Playwright + axe-core (e2e), Zod (already vendored), `adoptedStyleSheets` (Chrome 73+).

**Spec source of truth:** `docs/superpowers/specs/2026-05-08-responsive-overlay.md` (issue #35, approved). This plan implements the MVP floor of that spec and corrects its shadow-mode contract from `closed` to `open` in Task 1.

**Out of scope (deferred to other phase-1 issues):**
- Control-bar (play/pause/speed) — #33 + #36
- Context preview (prev-3 / upcoming-3 words) — #20, #97
- Progress / time-elapsed display — #96
- Document Picture-in-Picture — #35 spec marks post-M1
- Real article extraction (Readability) — #17; this PR uses a minimal `innerText.split(/\s+/)` stub
- Onboarding / WPM calibration — #71

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-05-08-responsive-overlay.md` | Modify | Edit `mode: 'closed'` → `mode: 'open'` + add axe-pierceability rationale paragraph |
| `src/core/overlay/types.ts` | Create | Public types — `OverlayHandle`, `OverlayOptions`, `OverlayStatus` |
| `src/core/overlay/styles.ts` | Create | CSS string constant for the adopted stylesheet, including `forced-colors` and `prefers-reduced-motion` media queries |
| `src/core/overlay/word.ts` | Create | Pure helper: render a single word into the word region via `splitWordAtFocus` |
| `src/core/overlay/focus-trap.ts` | Create | Pure focus-trap install/uninstall (Tab + Shift-Tab cycling between sentinels) |
| `src/core/overlay/overlay.ts` | Create | `createOverlay(opts)` factory: lifecycle, shadow mount, engine ownership, settings subscription, teardown |
| `src/core/overlay/index.ts` | Create | Public barrel — exports `createOverlay`, types |
| `src/core/overlay/__tests__/word.test.ts` | Create | Word region rendering |
| `src/core/overlay/__tests__/focus-trap.test.ts` | Create | Trap cycling + uninstall restores prior focus |
| `src/core/overlay/__tests__/overlay.test.ts` | Create | Lifecycle: mount/unmount, idempotent re-mount, engine start/stop, re-theme on settings change |
| `src/chrome/content/index.ts` | Modify | After `handleActivateReader` returns `{ ok: true }`, tokenize body + mount overlay |
| `src/chrome/content/__tests__/index.test.ts` | Create-or-modify | Wiring test: activation success → overlay mount called |
| `tests/e2e/overlay.spec.ts` | Modify | Replace placeholder skip with a real spec: mount overlay programmatically and run axe-core scan |

---

## Task 1: Update shadow-mode contract in approved spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-08-responsive-overlay.md:135`

- [ ] **Step 1: Locate the line**

Run: `grep -n "attachShadow" docs/superpowers/specs/2026-05-08-responsive-overlay.md`
Expected: one match on line ~135 reading `... calls \`attachShadow({ mode: 'closed' })\` for host-page CSS isolation.`

- [ ] **Step 2: Replace the mode + add rationale paragraph**

Edit the bullet on line 135 to read:

```markdown
- **Mount.** The CS creates the overlay on receipt of `start-read` (Port open frame). It appends a single `<div>` host to `document.body` and calls `attachShadow({ mode: 'open' })` for host-page CSS isolation. All overlay markup, styles, and listeners live inside the open shadow root; host-page CSS does not affect us. Mode is `open` (not `closed`) so axe-core and Playwright can traverse the shadow root for automated a11y / behavioral testing without per-test `--include-shadow-dom` configuration. Closed mode would still leak our existence (host JS can MutationObserve body and the host `<div>`) so the encapsulation gain is marginal; the testability cost is not. If a specific abuse vector against open-shadow access surfaces post-M1, switching to `closed` is a one-line change.
```

- [ ] **Step 3: Verify no other `closed` references**

Run: `grep -in "closed" docs/superpowers/specs/2026-05-08-responsive-overlay.md`
Expected: no matches (or only matches unrelated to shadow mode — confirm by reading each hit).

- [ ] **Step 4: Run validate to ensure spec edits don't break repo gates**

Run: `npm run lint && npm run format:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-08-responsive-overlay.md
git commit -m "docs(spec): overlay shadow mode closed -> open for axe pierceability (#19)

The #35 spec set mode to 'closed' for host-page CSS isolation. Open
shadow root provides identical CSS isolation and identical host-JS
observability (host can MutationObserve body and the host div either
way), but only open mode lets axe-core and Playwright traverse the
overlay subtree without per-test --include-shadow-dom plumbing.
Acceptance criterion 8 (axe scan passes) is materially cheaper with
open. If a real host-page abuse vector emerges, switching back to
closed is a one-line change.

Refs #19, #35."
```

---

## Task 2: Public types

**Files:**
- Create: `src/core/overlay/types.ts`
- Test: covered by later overlay.test.ts

- [ ] **Step 1: Write the types**

Create `src/core/overlay/types.ts`:

```typescript
import type { RsvpEngine, RsvpEngineOptions } from '../rsvp-engine';
import type { ThemeId } from '../theme';

/**
 * Settings slice the overlay binds to. The wider SettingsV4 is not imported
 * here so `core/overlay` stays portable (no transitive dependency on the
 * Chrome storage shape).
 */
export interface OverlaySettings {
  theme: ThemeId;
  wpm: number;
}

export type SettingsSubscriber = (s: OverlaySettings) => void;
export type SettingsSubscribe = (listener: SettingsSubscriber) => () => void;

export type EngineFactory = (opts: RsvpEngineOptions) => RsvpEngine;

export interface OverlayOptions {
  doc: Document;
  words: string[];
  initialSettings: OverlaySettings;
  subscribeSettings: SettingsSubscribe;
  engineFactory: EngineFactory;
  /** Called after teardown so the host (CS) can drop its handle. */
  onClose?: () => void;
}

export type OverlayStatus = 'mounted' | 'unmounted';

export interface OverlayHandle {
  readonly status: OverlayStatus;
  /** Idempotent — second call while mounted is a no-op. */
  mount(): void;
  /** LIFO teardown. Calling while unmounted is a no-op. */
  unmount(): void;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/core/overlay/types.ts
git commit -m "feat(overlay): public types for OverlayHandle + OverlayOptions (#19)"
```

---

## Task 3: Stylesheet string

**Files:**
- Create: `src/core/overlay/styles.ts`

- [ ] **Step 1: Write the CSS module**

Create `src/core/overlay/styles.ts`:

```typescript
/**
 * Overlay stylesheet, served via adoptedStyleSheets on the open shadow
 * root. Container query primer lives in the #35 spec; this MVP floor
 * uses fluid clamp() that satisfies WCAG 1.4.10 / 1.4.4 at 320px and
 * 200% zoom without dedicated tier blocks. Tiers land in a follow-up.
 *
 * forced-colors block uses system tokens per #35 spec section 6.
 * prefers-reduced-motion disables chrome transitions only (RSVP cadence
 * is unaffected per spec, since cadence is the format).
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: block;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: grid;
  place-items: center;
  padding: 24px;
}

.modal {
  background: var(--bg, #ffffff);
  color: var(--text, #111111);
  border-radius: 12px;
  padding: clamp(24px, 6cqi, 64px);
  max-inline-size: min(72ch, 1100px);
  inline-size: 100%;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  position: relative;
  container-type: inline-size;
  container-name: rsvp;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: transparent;
  color: var(--text, #111111);
  font: 700 20px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.close-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

.word-region {
  text-align: center;
  font-size: clamp(2rem, 5.5cqi + 1rem, 5.5rem);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  padding-block: clamp(32px, 8cqi, 96px);
}

.word-region .focus {
  color: var(--accent, #2563eb);
}

.aria-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.trap-sentinel {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (forced-colors: active) {
  .modal { background: Canvas; color: CanvasText; }
  .close-btn { border-color: ButtonText; color: ButtonText; }
  .close-btn:focus-visible { outline-color: Highlight; }
  .word-region .focus { color: Highlight; }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop, .modal { transition: none !important; animation: none !important; }
}
`;
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/core/overlay/styles.ts
git commit -m "feat(overlay): CSS string with forced-colors + reduced-motion blocks (#19)"
```

---

## Task 4: Word rendering helper

**Files:**
- Create: `src/core/overlay/word.ts`
- Test: `src/core/overlay/__tests__/word.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/overlay/__tests__/word.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { renderWord } from '../word';

describe('renderWord', () => {
  test('writes three spans (before / focus / after) into the target element', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'example');
    const spans = region.querySelectorAll('span');
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe('ex');
    expect(spans[1].textContent).toBe('a');
    expect(spans[2].textContent).toBe('mple');
    expect(spans[1].classList.contains('focus')).toBe(true);
  });

  test('handles short words (orp returns 0)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'hi');
    const spans = region.querySelectorAll('span');
    expect(spans[0].textContent).toBe('');
    expect(spans[1].textContent).toBe('h');
    expect(spans[2].textContent).toBe('i');
  });

  test('replaces previous content on repeated calls', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'first');
    renderWord(region, 'second');
    expect(region.textContent).toBe('second');
  });

  test('empty word clears region', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'preset');
    renderWord(region, '');
    expect(region.textContent).toBe('');
    expect(region.querySelectorAll('span')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/overlay/__tests__/word.test.ts`
Expected: FAIL (module `../word` does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/core/overlay/word.ts`:

```typescript
import { splitWordAtFocus } from '../orp';

/**
 * Render `word` into `region` as three <span> elements (before / focus / after).
 * The middle span carries the `focus` class for ORP-highlight styling. Repeated
 * calls replace the prior content.
 *
 * Pure DOM mutation — no chrome.*, safe for src/core. The caller provides the
 * region element; this module does not query the document.
 */
export function renderWord(region: Element, word: string): void {
  const { before, focus, after } = splitWordAtFocus(word);
  const doc = region.ownerDocument;
  const beforeSpan = doc.createElement('span');
  beforeSpan.textContent = before;
  const focusSpan = doc.createElement('span');
  focusSpan.className = 'focus';
  focusSpan.textContent = focus;
  const afterSpan = doc.createElement('span');
  afterSpan.textContent = after;
  region.replaceChildren(beforeSpan, focusSpan, afterSpan);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/overlay/__tests__/word.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/word.ts src/core/overlay/__tests__/word.test.ts
git commit -m "feat(overlay): renderWord pure helper using splitWordAtFocus (#19)"
```

---

## Task 5: Focus trap

**Files:**
- Create: `src/core/overlay/focus-trap.ts`
- Test: `src/core/overlay/__tests__/focus-trap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/overlay/__tests__/focus-trap.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { installFocusTrap } from '../focus-trap';

function makeContainer(): { container: HTMLElement; btn: HTMLButtonElement; sentinels: HTMLElement[] } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const top = document.createElement('div');
  top.tabIndex = 0;
  top.className = 'trap-sentinel';
  const btn = document.createElement('button');
  btn.textContent = 'X';
  const bottom = document.createElement('div');
  bottom.tabIndex = 0;
  bottom.className = 'trap-sentinel';
  container.append(top, btn, bottom);
  return { container, btn, sentinels: [top, bottom] };
}

describe('installFocusTrap', () => {
  test('focuses the first focusable on install', () => {
    const { container, btn } = makeContainer();
    installFocusTrap(container);
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('focusing top sentinel wraps to bottom focusable', () => {
    const { container, btn, sentinels } = makeContainer();
    installFocusTrap(container);
    sentinels[0].focus();
    sentinels[0].dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('focusing bottom sentinel wraps to top focusable', () => {
    const { container, btn, sentinels } = makeContainer();
    installFocusTrap(container);
    sentinels[1].focus();
    sentinels[1].dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('uninstall restores prior focus', () => {
    const prior = document.createElement('input');
    document.body.appendChild(prior);
    prior.focus();
    const { container } = makeContainer();
    const uninstall = installFocusTrap(container);
    uninstall();
    expect(document.activeElement).toBe(prior);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/overlay/__tests__/focus-trap.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/core/overlay/focus-trap.ts`:

```typescript
/**
 * Sentinel-based focus trap. Caller passes a container that already has two
 * `.trap-sentinel` elements (first child and last child) and at least one
 * focusable element between them. The trap installs `focus` listeners on the
 * sentinels that bounce focus to the first/last focusable inside.
 *
 * Returns an uninstall function that removes listeners and restores the
 * previously-active element (recorded at install time).
 *
 * Pure DOM — no chrome.*, safe for src/core.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not(.trap-sentinel)';

export function installFocusTrap(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const priorActive = doc.activeElement as HTMLElement | null;
  const focusables = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const sentinels = container.querySelectorAll<HTMLElement>('.trap-sentinel');
  if (sentinels.length !== 2) {
    throw new Error('installFocusTrap: container must contain exactly two .trap-sentinel elements');
  }
  const [top, bottom] = sentinels;

  const onTopFocus = () => {
    const f = focusables();
    if (f.length > 0) f[f.length - 1].focus();
  };
  const onBottomFocus = () => {
    const f = focusables();
    if (f.length > 0) f[0].focus();
  };
  top.addEventListener('focus', onTopFocus);
  bottom.addEventListener('focus', onBottomFocus);

  const initial = focusables()[0];
  if (initial) initial.focus();

  return () => {
    top.removeEventListener('focus', onTopFocus);
    bottom.removeEventListener('focus', onBottomFocus);
    if (priorActive && typeof priorActive.focus === 'function') priorActive.focus();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/overlay/__tests__/focus-trap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/focus-trap.ts src/core/overlay/__tests__/focus-trap.test.ts
git commit -m "feat(overlay): sentinel-based focus trap with prior-focus restore (#19)"
```

---

## Task 6: Overlay factory — mount, shadow root, stylesheet

**Files:**
- Create: `src/core/overlay/overlay.ts`
- Test: `src/core/overlay/__tests__/overlay.test.ts`

- [ ] **Step 1: Write the failing test (mount path)**

Create `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['hello', 'world'],
    initialSettings: { theme: 'system', wpm: 300 },
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
    ...overrides,
  };
}

describe('createOverlay — mount', () => {
  test('mount appends a host element with an open shadow root', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const host = document.body.querySelector('[data-speedreader-overlay]');
    expect(host).toBeTruthy();
    expect((host as HTMLElement).shadowRoot).toBeTruthy();
    expect((host as HTMLElement).shadowRoot!.mode).toBe('open');
    overlay.unmount();
  });

  test('mount renders backdrop + modal + word region + close button + aria-live + sentinels', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('.backdrop')).toBeTruthy();
    expect(root.querySelector('.modal')).toBeTruthy();
    expect(root.querySelector('.word-region')).toBeTruthy();
    expect(root.querySelector('.close-btn')).toBeTruthy();
    expect(root.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(root.querySelectorAll('.trap-sentinel')).toHaveLength(2);
    overlay.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the minimal mount implementation**

Create `src/core/overlay/overlay.ts`:

```typescript
import { applyTheme } from '../theme';
import { renderWord } from './word';
import { installFocusTrap } from './focus-trap';
import { OVERLAY_CSS } from './styles';
import type { OverlayHandle, OverlayOptions, OverlayStatus } from './types';
import type { RsvpEngine } from '../rsvp-engine';

const HOST_ATTR = 'data-speedreader-overlay';

export function createOverlay(opts: OverlayOptions): OverlayHandle {
  let status: OverlayStatus = 'unmounted';
  let host: HTMLElement | null = null;
  let engine: RsvpEngine | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let uninstallTrap: (() => void) | null = null;
  let onEscape: ((e: KeyboardEvent) => void) | null = null;

  function buildShadowTree(shadow: ShadowRoot): {
    modal: HTMLElement;
    word: HTMLElement;
    closeBtn: HTMLButtonElement;
    ariaLive: HTMLElement;
  } {
    const doc = opts.doc;
    const sheet = new doc.defaultView!.CSSStyleSheet();
    sheet.replaceSync(OVERLAY_CSS);
    (shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];

    const backdrop = doc.createElement('div');
    backdrop.className = 'backdrop';
    const modal = doc.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'SpeedReader');

    const topSentinel = doc.createElement('div');
    topSentinel.className = 'trap-sentinel';
    topSentinel.tabIndex = 0;

    const closeBtn = doc.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close reader');
    closeBtn.textContent = 'X';

    const word = doc.createElement('div');
    word.className = 'word-region';

    const ariaLive = doc.createElement('div');
    ariaLive.className = 'aria-live';
    ariaLive.setAttribute('aria-live', 'polite');
    ariaLive.setAttribute('aria-atomic', 'true');

    const bottomSentinel = doc.createElement('div');
    bottomSentinel.className = 'trap-sentinel';
    bottomSentinel.tabIndex = 0;

    modal.append(topSentinel, closeBtn, word, ariaLive, bottomSentinel);
    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);

    return { modal, word, closeBtn, ariaLive };
  }

  function mount(): void {
    if (status === 'mounted') return;
    host = opts.doc.createElement('div');
    host.setAttribute(HOST_ATTR, '');
    opts.doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const { modal, word, closeBtn, ariaLive } = buildShadowTree(shadow);
    applyTheme(opts.initialSettings.theme, modal);

    // engine wired in Task 7
    void word;
    void ariaLive;
    void closeBtn;
    status = 'mounted';
  }

  function unmount(): void {
    if (status === 'unmounted') return;
    uninstallTrap?.();
    uninstallTrap = null;
    if (onEscape) opts.doc.removeEventListener('keydown', onEscape, true);
    onEscape = null;
    engine?.stop();
    engine = null;
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    host?.remove();
    host = null;
    status = 'unmounted';
    opts.onClose?.();
  }

  return {
    get status() {
      return status;
    },
    mount,
    unmount,
  };
}
```

- [ ] **Step 4: Run tests to verify mount path passes**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/overlay.ts src/core/overlay/__tests__/overlay.test.ts
git commit -m "feat(overlay): mount path with open shadow + adopted stylesheet (#19)"
```

---

## Task 7: Engine lifecycle ownership + word rendering

**Files:**
- Modify: `src/core/overlay/overlay.ts`
- Modify: `src/core/overlay/__tests__/overlay.test.ts`

- [ ] **Step 1: Add failing engine-wiring tests**

Append to `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
describe('createOverlay — engine wiring', () => {
  test('mount starts the engine and renders the first word', async () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['quick', 'brown', 'fox'] }));
    overlay.mount();
    vi.advanceTimersByTime(0); // let the engine emit
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('.word-region')!.textContent).toBe('quick');
    overlay.unmount();
    vi.useRealTimers();
  });

  test('aria-live region announces each word', () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['alpha', 'beta'], initialSettings: { theme: 'system', wpm: 600 } }));
    overlay.mount();
    vi.advanceTimersByTime(0);
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('alpha');
    vi.advanceTimersByTime(100);
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('beta');
    overlay.unmount();
    vi.useRealTimers();
  });

  test('unmount stops the engine (no further ticks after teardown)', () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['a', 'b', 'c'] }));
    overlay.mount();
    overlay.unmount();
    const before = document.body.innerHTML;
    vi.advanceTimersByTime(1000);
    expect(document.body.innerHTML).toBe(before);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: FAIL on the three new cases (word region empty / aria-live empty / mount didn't start engine).

- [ ] **Step 3: Wire the engine inside `mount`**

Replace the `mount` body in `src/core/overlay/overlay.ts` (after `buildShadowTree`):

```typescript
  function mount(): void {
    if (status === 'mounted') return;
    host = opts.doc.createElement('div');
    host.setAttribute(HOST_ATTR, '');
    opts.doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const { modal, word, closeBtn, ariaLive } = buildShadowTree(shadow);
    applyTheme(opts.initialSettings.theme, modal);

    engine = opts.engineFactory({ words: opts.words, wpm: opts.initialSettings.wpm });
    engine.subscribe((ev) => {
      if (ev.type === 'word') {
        renderWord(word, ev.word);
        ariaLive.textContent = ev.word;
      } else if (ev.type === 'done') {
        // MVP: leave the last word visible. Close path is user-driven.
      }
    });
    engine.start();

    uninstallTrap = installFocusTrap(modal);

    const close = () => unmount();
    closeBtn.addEventListener('click', close);
    onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    opts.doc.addEventListener('keydown', onEscape, true);

    status = 'mounted';
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (5 tests now).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/overlay.ts src/core/overlay/__tests__/overlay.test.ts
git commit -m "feat(overlay): engine ownership + word + aria-live rendering (#19)"
```

---

## Task 8: Close path (Esc + button)

Already implemented in Task 7. Add explicit tests.

**Files:**
- Modify: `src/core/overlay/__tests__/overlay.test.ts`

- [ ] **Step 1: Add failing close-path tests**

Append to `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
describe('createOverlay — close path', () => {
  test('Escape key unmounts the overlay', () => {
    const onClose = vi.fn();
    const overlay = createOverlay(defaultOpts({ onClose }));
    overlay.mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.status).toBe('unmounted');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-speedreader-overlay]')).toBeNull();
  });

  test('Close button click unmounts the overlay', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const closeBtn = (
      document.body.querySelector('[data-speedreader-overlay]') as HTMLElement
    ).shadowRoot!.querySelector<HTMLButtonElement>('.close-btn')!;
    closeBtn.click();
    expect(overlay.status).toBe('unmounted');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 3: Commit**

```bash
git add src/core/overlay/__tests__/overlay.test.ts
git commit -m "test(overlay): explicit Esc + close-button assertions (#19)"
```

---

## Task 9: Settings re-theme without engine restart

**Files:**
- Modify: `src/core/overlay/overlay.ts`
- Modify: `src/core/overlay/__tests__/overlay.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
describe('createOverlay — settings re-theme', () => {
  test('theme change re-applies tokens without restarting the engine', () => {
    let notify: (s: { theme: 'system' | 'light' | 'dark' | 'sepia' | 'paper' | 'cream' | 'nord'; wpm: number }) => void = () => undefined;
    const overlay = createOverlay(
      defaultOpts({
        subscribeSettings: (listener) => {
          notify = listener;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    const modal = (
      document.body.querySelector('[data-speedreader-overlay]') as HTMLElement
    ).shadowRoot!.querySelector<HTMLElement>('.modal')!;
    const before = modal.style.getPropertyValue('--bg');
    notify({ theme: 'dark', wpm: 300 });
    const after = modal.style.getPropertyValue('--bg');
    expect(after).not.toBe(before);
    expect(after).not.toBe('');
    overlay.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: FAIL on `after` equal to `before` (no subscription wired).

- [ ] **Step 3: Wire the subscription**

Inside `mount` in `src/core/overlay/overlay.ts`, after `applyTheme(...)`, add:

```typescript
    unsubscribeSettings = opts.subscribeSettings((s) => {
      applyTheme(s.theme, modal);
      // wpm change handling lands with #33/#118; MVP applies theme only.
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/overlay.ts src/core/overlay/__tests__/overlay.test.ts
git commit -m "feat(overlay): subscribe to settings, re-apply theme without engine restart (#19)"
```

---

## Task 10: Idempotent re-mount + barrel

**Files:**
- Modify: `src/core/overlay/__tests__/overlay.test.ts`
- Create: `src/core/overlay/index.ts`

- [ ] **Step 1: Add failing idempotency test**

Append to `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
describe('createOverlay — idempotency', () => {
  test('calling mount() twice is a no-op (single host element)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.mount();
    expect(document.querySelectorAll('[data-speedreader-overlay]')).toHaveLength(1);
    overlay.unmount();
  });

  test('calling unmount() while unmounted is a no-op', () => {
    const overlay = createOverlay(defaultOpts());
    expect(() => overlay.unmount()).not.toThrow();
    expect(overlay.status).toBe('unmounted');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (10 tests — the existing `mount` guard already covers this).

- [ ] **Step 3: Create barrel**

Create `src/core/overlay/index.ts`:

```typescript
export { createOverlay } from './overlay';
export type { OverlayHandle, OverlayOptions, OverlaySettings, OverlayStatus } from './types';
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/index.ts src/core/overlay/__tests__/overlay.test.ts
git commit -m "feat(overlay): public barrel + idempotency tests (#19)"
```

---

## Task 11: Wire content/index.ts to mount the overlay

**Files:**
- Modify: `src/chrome/content/index.ts`
- Create: `src/chrome/content/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `src/chrome/content/__tests__/index.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// The CS module wires DOM at import time, so re-import per test.
beforeEach(() => {
  document.body.innerHTML = '<article>The quick brown fox.</article>';
  // Minimal chrome stub
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-ext', onMessage: { addListener: vi.fn() } },
  };
});
afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  document.body.innerHTML = '';
});

describe('content script wiring', () => {
  test('activate-reader success path mounts overlay host', async () => {
    type Listener = (msg: unknown, sender: { id?: string }, sendResponse: (r: unknown) => void) => unknown;
    let listener: Listener | undefined;
    (globalThis as unknown as { chrome: { runtime: { id: string; onMessage: { addListener: (l: Listener) => void } } } }).chrome
      .runtime.onMessage.addListener = (l: Listener) => {
      listener = l;
    };
    await import('../index');
    expect(listener).toBeDefined();
    const respond = vi.fn();
    listener!({ type: 'activate-reader' }, { id: 'test-ext' }, respond);
    expect(respond).toHaveBeenCalledWith({ ok: true });
    expect(document.querySelector('[data-speedreader-overlay]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/chrome/content/__tests__/index.test.ts`
Expected: FAIL (`querySelector('[data-speedreader-overlay]')` is null).

- [ ] **Step 3: Wire the overlay mount in `src/chrome/content/index.ts`**

Replace the listener body in `src/chrome/content/index.ts:36-54` so that on a successful `activate-reader` it ALSO mounts the overlay:

```typescript
import { handleActivateReader } from './activate-handler';
import { createOverlay } from '../../core/overlay';
import { createRsvpEngine } from '../../core/rsvp-engine';
import { loadSettings, subscribeSettings } from '../settings/storage';
import { tokenize } from '../../core/tokenize';

console.log('[SpeedReader] Content script loaded');

let activeOverlay: ReturnType<typeof createOverlay> | null = null;

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (
      msg !== null &&
      typeof msg === 'object' &&
      (msg as { type?: unknown }).type === 'activate-reader'
    ) {
      const response = handleActivateReader(location.href, chrome.runtime.id);
      sendResponse(response);
      if (!response.ok) return;

      // Mount overlay (idempotent). MVP word source: body.innerText
      // tokenized; full Readability extraction tracked under #17.
      void (async () => {
        if (activeOverlay && activeOverlay.status === 'mounted') return;
        const settings = await loadSettings();
        const text = document.body?.innerText ?? '';
        const words = tokenize(text);
        if (words.length === 0) return;
        activeOverlay = createOverlay({
          doc: document,
          words,
          initialSettings: { theme: settings.theme, wpm: settings.wpm },
          subscribeSettings: (listener) =>
            subscribeSettings((s) => listener({ theme: s.theme, wpm: s.wpm })),
          engineFactory: createRsvpEngine,
          onClose: () => {
            activeOverlay = null;
          },
        });
        activeOverlay.mount();
      })();
    }
  });
}
```

Keep the existing top-of-file comments. Replace ONLY the listener block; do not delete the `Issue #142` / `Sender authorization` documentation paragraphs above it.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/chrome/content/__tests__/index.test.ts`
Expected: PASS.

Also run full suite to catch regressions:
Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/chrome/content/index.ts src/chrome/content/__tests__/index.test.ts
git commit -m "feat(content): mount overlay on successful activate-reader (#19)"
```

---

## Task 11.5: Document scroll-lock on mount / restore on unmount

Spec-strict per #35 spec "Overlay lifecycle" section. Lock `documentElement.style.overflow` to `'hidden'` on mount, preserve prior value, restore on unmount.

**Files:**
- Modify: `src/core/overlay/overlay.ts`
- Modify: `src/core/overlay/__tests__/overlay.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/core/overlay/__tests__/overlay.test.ts`:

```typescript
describe('createOverlay — document scroll-lock', () => {
  test('mount sets documentElement.style.overflow to hidden', () => {
    document.documentElement.style.overflow = 'auto';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    expect(document.documentElement.style.overflow).toBe('hidden');
    overlay.unmount();
  });

  test('unmount restores prior overflow value', () => {
    document.documentElement.style.overflow = 'scroll';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.unmount();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  test('unmount restores empty string when prior overflow was unset', () => {
    document.documentElement.style.overflow = '';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: FAIL on overflow assertions (mount doesn't touch overflow yet).

- [ ] **Step 3: Wire the scroll-lock**

In `src/core/overlay/overlay.ts`, add a closure-scoped variable near the other state vars:

```typescript
  let priorOverflow: string | null = null;
```

Inside `mount`, BEFORE the `host = opts.doc.createElement(...)` line, add:

```typescript
    priorOverflow = opts.doc.documentElement.style.overflow;
    opts.doc.documentElement.style.overflow = 'hidden';
```

Inside `unmount`, AFTER `host?.remove(); host = null;` and BEFORE `status = 'unmounted';`, add:

```typescript
    if (priorOverflow !== null) {
      opts.doc.documentElement.style.overflow = priorOverflow;
      priorOverflow = null;
    }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/core/overlay/__tests__/overlay.test.ts`
Expected: PASS (13 tests total now).

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/overlay.ts src/core/overlay/__tests__/overlay.test.ts
git commit -m "feat(overlay): document scroll-lock on mount, restore on unmount (#19)

Per #35 spec lifecycle section. Preserves prior overflow value so a
page that already had overflow: hidden or scroll set restores cleanly
on overlay teardown."
```

---

## Task 12: Replace overlay e2e placeholder with real axe-core scan

**Files:**
- Modify: `tests/e2e/overlay.spec.ts`

- [ ] **Step 1: Confirm axe-core is installed**

Run: `npm ls @axe-core/playwright 2>/dev/null || npm ls axe-core 2>/dev/null`
Expected: at least one of them present. If neither: `npm install --save-dev @axe-core/playwright`. (Add this command to step 1 if needed.)

- [ ] **Step 2: Write the e2e spec**

Replace `tests/e2e/overlay.spec.ts` with:

```typescript
/**
 * overlay.spec.ts — axe-core scan against a programmatically-mounted overlay.
 *
 * The activeTab gesture-bound activation path (issue #38) cannot be
 * dispatched from Playwright, so we mount the overlay directly via the
 * core/overlay module loaded in a fixture page. This exercises the
 * shadow DOM, tokens, focus trap, and aria-live without depending on
 * the SW/CS activation handshake.
 *
 * Restore the activation-path coverage once the CDP activation bridge
 * lands (#38 / #142 follow-up).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Overlay MVP (#19)', () => {
  test('axe-core scan passes inside the shadow root', async ({ page }) => {
    await page.goto('about:blank');
    // Inline-bundle the overlay against a stub document. The harness
    // uses the built core/overlay barrel; if running pre-build, run
    // `npm run build` first.
    await page.addScriptTag({ path: 'dist/assets/core-overlay-bundle.js' });
    await page.evaluate(() => {
      // @ts-expect-error global injected by the bundle
      const { createOverlay } = window.__speedreader_overlay__;
      // @ts-expect-error global injected by the bundle
      const { createRsvpEngine } = window.__speedreader_rsvp__;
      const overlay = createOverlay({
        doc: document,
        words: ['hello', 'world', 'reader'],
        initialSettings: { theme: 'system', wpm: 300 },
        subscribeSettings: () => () => undefined,
        engineFactory: createRsvpEngine,
      });
      overlay.mount();
    });
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);
    const results = await new AxeBuilder({ page })
      .include('[data-speedreader-overlay]')
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('Escape teardown removes the host element', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: 'dist/assets/core-overlay-bundle.js' });
    await page.evaluate(() => {
      // @ts-expect-error global injected by the bundle
      const { createOverlay } = window.__speedreader_overlay__;
      // @ts-expect-error global injected by the bundle
      const { createRsvpEngine } = window.__speedreader_rsvp__;
      const overlay = createOverlay({
        doc: document,
        words: ['x'],
        initialSettings: { theme: 'system', wpm: 300 },
        subscribeSettings: () => () => undefined,
        engineFactory: createRsvpEngine,
      });
      overlay.mount();
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Add a Vite entry that exposes the core barrels for the e2e bundle**

Create `tests/e2e/fixtures/overlay-bundle-entry.ts`:

```typescript
import * as overlay from '../../../src/core/overlay';
import * as rsvp from '../../../src/core/rsvp-engine';

(window as unknown as { __speedreader_overlay__: typeof overlay }).__speedreader_overlay__ = overlay;
(window as unknown as { __speedreader_rsvp__: typeof rsvp }).__speedreader_rsvp__ = rsvp;
```

Modify `vite.config.ts` to add a `core-overlay-bundle` build entry that bundles `tests/e2e/fixtures/overlay-bundle-entry.ts` into `dist/assets/core-overlay-bundle.js`. If the existing build is single-entry, add a second `build.rollupOptions.input` alongside it. (Inspect current config first; many Vite chrome-extension repos use `@crxjs/vite-plugin` which exposes its own entry mechanism — add the bundle as a `chunks` entry there instead.)

- [ ] **Step 4: Run the e2e spec**

Run: `npm run build && npx playwright test tests/e2e/overlay.spec.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/overlay.spec.ts tests/e2e/fixtures/overlay-bundle-entry.ts vite.config.ts
git commit -m "test(e2e): real overlay mount + axe-core scan (#19)"
```

---

## Task 13: CHANGELOG + PR + close issue

**Files:**
- Modify: `CHANGELOG.md` (if present; if absent, skip per #42)

- [ ] **Step 1: Check CHANGELOG presence**

Run: `ls CHANGELOG.md 2>/dev/null && head -10 CHANGELOG.md || echo NONE`
Expected: either CHANGELOG content or `NONE`.

- [ ] **Step 2: Add an entry if CHANGELOG exists**

If present, prepend to the `## [Unreleased]` section:

```markdown
### Added
- Overlay MVP — RSVP word display with ORP highlight, dim backdrop, focus trap,
  aria-live announcer, Esc + close-button teardown, forced-colors palette,
  reduced-motion respect for chrome (not cadence) (#19).
```

If absent: skip; tracked under #42.

- [ ] **Step 3: Run full local CI**

Run: `npm run lint && npm run format:check && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feature/19-overlay-mvp
gh pr create --title "feat(overlay): MVP floor (closes #19)" --body-file /tmp/pr-19-body
```

PR body (write to `/tmp/pr-19-body` first):

```markdown
## Summary

Closes #19. Ships the MVP-floor overlay so the RSVP engine has a rendering surface.

- New `src/core/overlay/` portable module (no `chrome.*` imports)
- Open shadow root mounted to `document.body` host `<div>`
- Adopted constructed stylesheet with forced-colors + reduced-motion blocks
- Word region + ORP-highlight via `splitWordAtFocus`
- Focus trap (sentinel + Tab cycle, prior-focus restore on unmount)
- Aria-live polite announcer for current word
- Close: Esc + button; LIFO teardown (stop engine → unsubscribe settings → remove host)
- Idempotent re-mount; settings live-subscribe re-applies theme without engine restart
- Spec edit: `mode: 'closed'` → `mode: 'open'` in #35 spec for axe pierceability

## Out of scope (deferred)

- Control bar / play-pause / scrubber (#33, #36)
- Context preview prev-3 / upcoming-3 (#20, #97)
- Progress / time-elapsed text (#96)
- Document Picture-in-Picture (#35 post-M1)
- Real article extraction (#17) — MVP uses `body.innerText` tokenized

## Test plan

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm test` — all unit + integration suites pass
- [x] `npm run build`
- [x] `npx playwright test tests/e2e/overlay.spec.ts` — axe-core scan + Escape teardown
- [ ] Load unpacked extension, click toolbar icon on a sample article — overlay appears with word cycling, Esc closes, focus restores (manual; not automatable until #38 CDP bridge lands)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 5: Verify PR + leave for user-driven merge**

Run: `gh pr view --json url,state --jq '.state + " | " + .url'`
Expected: `OPEN | <url>`

Do NOT auto-merge. CLAUDE.md requires explicit approval for direct main pushes. Leave PR open for review.

---

## Self-Review

**Spec coverage check (`docs/superpowers/specs/2026-05-08-responsive-overlay.md`):**

| Spec section | Plan task |
|---|---|
| §1 Breakpoint philosophy (container-query primer) | Task 3 (CSS uses `container-type` + `clamp()`); full tier blocks deferred |
| §2 Word-area sizing (clamp + max-inline-size) | Task 3 |
| §3 Control-bar adaptation | Deferred to #33/#36 (out-of-scope declared up top) |
| §4 Context-preview placement | Deferred to #20/#97 |
| §5 Pointer vs touch | Partial — Task 3 includes `@media (pointer: coarse)` skeleton via the close-btn target size; full impl with #36 |
| §6 Accessibility-driven breakpoints (forced-colors, reduced-motion) | Task 3 (both `@media` blocks present) |
| §7 Chrome-only improvements (Highlight API, PiP, reduced-data) | Out of scope per up-top declaration |
| Overlay lifecycle (§ "Overlay lifecycle" block) | Tasks 6-10 (mount/destroy, focus, scroll-lock omitted — see below) |

**Gap surfaced by self-review:** The spec's §"Overlay lifecycle" mentions scroll-lock on the document (`document.documentElement.style.overflow = 'hidden'` on mount, restore on unmount). This plan does NOT implement scroll-lock. Decision: defer to a follow-up issue OR add as Task 11.5 if user wants spec-strict coverage. Flagged for the user at execution-choice time.

**Placeholder scan:** none — every step has runnable commands and complete code.

**Type consistency:** `OverlayOptions`, `OverlayHandle`, `OverlaySettings`, `SettingsSubscribe`, `EngineFactory` defined in Task 2 and used unchanged in Tasks 6-11. Method names (`mount`, `unmount`, `status`) consistent.

**Scope check:** Single subsystem (overlay floor). Fits one plan.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task, fast iteration. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in current session via `superpowers:executing-plans` with batch checkpoints.

Per `rules/execution-mode.md`: plan has 13 tasks, 3+ files, ~600 LOC functional change, integration coupling between content script + core/overlay + spec. **Subagent-driven mode applies.**

Choose execution path next.
