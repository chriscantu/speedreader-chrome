import { applyTheme } from '../theme';
import type { ThemeId } from '../theme';
import { OVERLAY_CSS } from './styles';
import { OVERLAY_ATTR, OVERLAY_CLASS, OVERLAY_ID, OVERLAY_TEXT } from './constants';
import type {
  OverlayCloseSnapshot,
  OverlayHandle,
  OverlayOptions,
  OverlayScope,
  OverlayStatus,
} from './types';
import type { RsvpEngine } from '../rsvp-engine';
import { renderWord } from './word';
import { buildSentenceContext } from './sentence-context';
import { installFocusTrap } from './focus-trap';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  WPM_MAX,
  WPM_MIN,
  WPM_STEP,
} from '../settings/bounds';

/**
 * Snapshot of the scope-aware view at mount time. The CS pre-tokenizes both
 * selection and full streams, so building the header text and choosing the
 * active engine words is purely local.
 */
interface ScopeView {
  /** Resolved scope: 'selection' or 'full'. */
  readonly scope: OverlayScope;
  /** Engine word stream chosen by the resolved scope. */
  readonly activeWords: string[];
  /** Text rendered inside the scoped header h2. */
  readonly headerText: string;
  /** True when the `← Full article` scope-swap button should be rendered. */
  readonly showSwapBtn: boolean;
  /**
   * Non-null when an empty-selection fallback fired. Drives the visible
   * subtitle and one-shot aria-live announcement (AC #15).
   */
  readonly fallback: 'empty-selection' | null;
}

function buildScopeView(opts: OverlayOptions): ScopeView | null {
  if (!opts.scope) return null;

  const wpm = opts.initialSettings.wpm;
  const selectionWords = opts.selectionWords ?? [];
  const fullWords = opts.fullWords ?? [];
  const formatSec = (n: number): number => Math.round((n * 60) / wpm);

  if (opts.scope === 'selection' && selectionWords.length > 0) {
    return {
      scope: 'selection',
      activeWords: selectionWords,
      headerText: OVERLAY_TEXT.scopedHeader(
        selectionWords.length,
        formatSec(selectionWords.length),
      ),
      showSwapBtn: true,
      fallback: null,
    };
  }

  const title = opts.articleTitle?.trim();
  // Empty-selection fallback: user requested 'selection' but the selection
  // text was empty (cleared between menu open and click, or never present
  // on a non-text context-menu invocation). Resolve to full-article scope
  // and flag the fallback so the overlay surfaces an explanatory subtitle
  // and a one-shot polite announcement (spec §"Selection cleared between
  // menu open and click", AC #15).
  const fallback = opts.scope === 'selection' ? 'empty-selection' : null;
  return {
    scope: 'full',
    activeWords: fullWords,
    headerText:
      title && title.length > 0 ? title : OVERLAY_TEXT.fullHeaderFallback(fullWords.length),
    showSwapBtn: false,
    fallback,
  };
}

/**
 * Resolve the 'system' sentinel to a concrete ThemeId using
 * prefers-color-scheme. Falls back to 'light' in environments that do not
 * support matchMedia (e.g. jsdom without a media-query stub).
 */
function resolveTheme(theme: ThemeId | 'system', win: Window & typeof globalThis): ThemeId {
  if (theme !== 'system') return theme;
  try {
    return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const HOST_ATTR = OVERLAY_ATTR.HOST;

export function createOverlay(opts: OverlayOptions): OverlayHandle {
  let status: OverlayStatus = 'unmounted';
  let host: HTMLElement | null = null;
  let engine: RsvpEngine | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let uninstallTrap: (() => void) | null = null;
  let onKeydown: ((e: KeyboardEvent) => void) | null = null;
  // #26 — live OS theme listener teardown. Attached during mount when
  // matchMedia is available; the same closure is invoked by
  // `subscribeSettings` to swap behaviour when the user toggles the
  // theme between `'system'` and an explicit override.
  let uninstallSystemThemeListener: (() => void) | null = null;
  let priorOverflow: string | null = null;
  // Lifted into the outer closure so `unmount()` can build the close
  // snapshot for `onClose` (#25). Reassigned on scope-swap so the
  // snapshot reflects the active stream at close time, not the mount
  // time scope. `null` when the caller used the legacy single-stream
  // form (no `scope` in OverlayOptions) — snapshot is suppressed in
  // that case since there's no scope key for the host to map under.
  let currentScope: OverlayScope | null = null;

  function buildShadowTree(
    shadow: ShadowRoot,
    scopeView: ScopeView | null,
  ): {
    modal: HTMLElement;
    header: HTMLElement;
    word: HTMLElement;
    closeBtn: HTMLButtonElement;
    playPauseBtn: HTMLButtonElement;
    swapBtn: HTMLButtonElement | null;
    fontDecBtn: HTMLButtonElement;
    fontIncBtn: HTMLButtonElement;
    prevSentenceBtn: HTMLButtonElement;
    nextSentenceBtn: HTMLButtonElement;
    wpmSlider: HTMLInputElement;
    wpmReadout: HTMLElement;
    ariaLive: HTMLElement;
    preview: HTMLElement;
  } {
    const doc = opts.doc;

    const ctor = doc.defaultView?.CSSStyleSheet;
    if (typeof ctor === 'function') {
      const sheet = new ctor();
      sheet.replaceSync(OVERLAY_CSS);
      (shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
    } else {
      // Fallback for environments without constructable stylesheets (e.g. older
      // jsdom). Inline <style> achieves the same scoping inside the shadow root.
      const styleEl = doc.createElement('style');
      styleEl.textContent = OVERLAY_CSS;
      shadow.appendChild(styleEl);
    }

    const backdrop = doc.createElement('div');
    backdrop.className = OVERLAY_CLASS.BACKDROP;
    const modal = doc.createElement('div');
    modal.className = OVERLAY_CLASS.MODAL;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', OVERLAY_ID.SCOPE_HEADER);

    const header = doc.createElement('h2');
    header.id = OVERLAY_ID.SCOPE_HEADER;
    header.className = OVERLAY_CLASS.SCOPE_HEADER;
    header.textContent = scopeView?.headerText ?? OVERLAY_TEXT.DEFAULT_HEADER;

    let subtitle: HTMLElement | null = null;
    if (scopeView?.fallback === 'empty-selection') {
      subtitle = doc.createElement('p');
      subtitle.className = OVERLAY_CLASS.SCOPE_SUBTITLE;
      subtitle.textContent = OVERLAY_TEXT.EMPTY_SELECTION_FALLBACK;
    }

    const topSentinel = doc.createElement('div');
    topSentinel.className = OVERLAY_CLASS.TRAP_SENTINEL;
    topSentinel.tabIndex = 0;

    const closeBtn = doc.createElement('button');
    closeBtn.className = OVERLAY_CLASS.CLOSE_BTN;
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', OVERLAY_TEXT.CLOSE_LABEL);
    closeBtn.textContent = OVERLAY_TEXT.CLOSE_GLYPH;

    const word = doc.createElement('div');
    word.className = OVERLAY_CLASS.WORD_REGION;

    // Surrounding-sentence preview (#20). Hidden by default; the pause
    // hook in mount() shows it with before/<strong>current</strong>/after.
    // Built with textContent + a single appended <strong> (no innerHTML,
    // no XSS surface).
    const preview = doc.createElement('div');
    preview.className = OVERLAY_CLASS.CONTEXT_PREVIEW;
    preview.setAttribute('role', 'region');
    preview.setAttribute('aria-label', OVERLAY_TEXT.CONTEXT_LABEL);
    preview.hidden = true;

    const ariaLive = doc.createElement('div');
    ariaLive.className = OVERLAY_CLASS.ARIA_LIVE;
    ariaLive.setAttribute('aria-live', 'polite');
    ariaLive.setAttribute('aria-atomic', 'true');

    const footer = doc.createElement('div');
    footer.className = OVERLAY_CLASS.FOOTER;

    let swapBtn: HTMLButtonElement | null = null;
    if (scopeView?.showSwapBtn) {
      swapBtn = doc.createElement('button');
      swapBtn.className = OVERLAY_CLASS.SCOPE_SWAP_BTN;
      swapBtn.type = 'button';
      swapBtn.textContent = OVERLAY_TEXT.SWAP_GLYPH;
      swapBtn.setAttribute('aria-label', OVERLAY_TEXT.SWAP_LABEL);
      footer.appendChild(swapBtn);
    }

    // Font-size stepper (#29). Placed before play/pause so the visual
    // order in LTR reading is [A−] [A+] [Play/Pause]; tab order matches
    // DOM order. Both ≥44×44 px via the .font-step-btn CSS rules in
    // styles.ts (mirrors the close-btn dimensions to satisfy WCAG 2.5.5).
    const fontDecBtn = doc.createElement('button');
    fontDecBtn.className = OVERLAY_CLASS.FONT_DEC_BTN;
    fontDecBtn.type = 'button';
    fontDecBtn.textContent = OVERLAY_TEXT.FONT_DEC_GLYPH;
    fontDecBtn.setAttribute('aria-label', OVERLAY_TEXT.FONT_DEC_LABEL);
    footer.appendChild(fontDecBtn);

    const fontIncBtn = doc.createElement('button');
    fontIncBtn.className = OVERLAY_CLASS.FONT_INC_BTN;
    fontIncBtn.type = 'button';
    fontIncBtn.textContent = OVERLAY_TEXT.FONT_INC_GLYPH;
    fontIncBtn.setAttribute('aria-label', OVERLAY_TEXT.FONT_INC_LABEL);
    footer.appendChild(fontIncBtn);

    // Prev-sentence button (#23). Placed before play/pause so the visual
    // order in LTR reading is [⏮] [Play/Pause] [⏭]. Click handler is
    // wired in mount() so it can capture the engine reference.
    const prevSentenceBtn = doc.createElement('button');
    prevSentenceBtn.className = OVERLAY_CLASS.PREV_SENTENCE_BTN;
    prevSentenceBtn.type = 'button';
    prevSentenceBtn.textContent = OVERLAY_TEXT.PREV_SENTENCE_GLYPH;
    prevSentenceBtn.setAttribute('aria-label', OVERLAY_TEXT.PREV_SENTENCE_LABEL);
    footer.appendChild(prevSentenceBtn);

    const playPauseBtn = doc.createElement('button');
    playPauseBtn.className = OVERLAY_CLASS.PLAY_PAUSE_BTN;
    playPauseBtn.type = 'button';
    footer.appendChild(playPauseBtn);

    const nextSentenceBtn = doc.createElement('button');
    nextSentenceBtn.className = OVERLAY_CLASS.NEXT_SENTENCE_BTN;
    nextSentenceBtn.type = 'button';
    nextSentenceBtn.textContent = OVERLAY_TEXT.NEXT_SENTENCE_GLYPH;
    nextSentenceBtn.setAttribute('aria-label', OVERLAY_TEXT.NEXT_SENTENCE_LABEL);
    footer.appendChild(nextSentenceBtn);

    // WPM slider (#24) + readout. Bounds are [WPM_MIN, WPM_MAX] = [100, 600]
    // (#16). Slider value is set in mount() from currentWpm so the initial
    // position reflects initialSettings.wpm even when callers pass non-default
    // values.
    const wpmSlider = doc.createElement('input');
    wpmSlider.className = OVERLAY_CLASS.WPM_SLIDER;
    wpmSlider.type = 'range';
    wpmSlider.min = String(WPM_MIN);
    wpmSlider.max = String(WPM_MAX);
    wpmSlider.step = String(WPM_STEP);
    wpmSlider.setAttribute('aria-label', OVERLAY_TEXT.WPM_SLIDER_LABEL);
    footer.appendChild(wpmSlider);

    const wpmReadout = doc.createElement('span');
    wpmReadout.className = OVERLAY_CLASS.WPM_READOUT;
    // The slider already exposes its value via aria-label + role; the readout
    // is a visual companion. aria-hidden avoids duplicate announcements.
    wpmReadout.setAttribute('aria-hidden', 'true');
    footer.appendChild(wpmReadout);

    const bottomSentinel = doc.createElement('div');
    bottomSentinel.className = OVERLAY_CLASS.TRAP_SENTINEL;
    bottomSentinel.tabIndex = 0;

    const children: Node[] = [topSentinel, closeBtn, header];
    if (subtitle) children.push(subtitle);
    children.push(word, preview, ariaLive, footer, bottomSentinel);
    modal.append(...children);
    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);

    return {
      modal,
      header,
      word,
      closeBtn,
      playPauseBtn,
      swapBtn,
      fontDecBtn,
      fontIncBtn,
      prevSentenceBtn,
      nextSentenceBtn,
      wpmSlider,
      wpmReadout,
      ariaLive,
      preview,
    };
  }

  function mount(): void {
    if (status === 'mounted') return;
    priorOverflow = opts.doc.documentElement.style.overflow;
    opts.doc.documentElement.style.overflow = 'hidden';
    host = opts.doc.createElement('div');
    host.setAttribute(HOST_ATTR, '');
    // Critical positioning styles inline with !important so external host-page
    // CSS targeting `div` cannot override them. `:host` selector specificity
    // is (0,0,0) which any outer-document `div` rule beats; inline !important
    // beats everything short of another inline !important. See real-article
    // verification on MDN (#19).
    host.style.cssText =
      'all: initial !important;' +
      'position: fixed !important;' +
      'top: 0 !important; right: 0 !important; bottom: 0 !important; left: 0 !important;' +
      'width: 100vw !important; height: 100vh !important;' +
      'z-index: 2147483647 !important;' +
      'display: block !important;' +
      'pointer-events: auto !important;';
    opts.doc.body.appendChild(host);
    const view = opts.doc.defaultView;
    if (!view) {
      throw new Error('createOverlay.mount: doc.defaultView is null (document is detached)');
    }
    let scopeView = buildScopeView(opts);
    currentScope = scopeView?.scope ?? null;
    const shadow = host.attachShadow({ mode: 'open' });
    const {
      modal,
      header,
      word,
      closeBtn,
      playPauseBtn,
      swapBtn,
      fontDecBtn,
      fontIncBtn,
      prevSentenceBtn,
      nextSentenceBtn,
      wpmSlider,
      wpmReadout,
      ariaLive,
      preview,
    } = buildShadowTree(shadow, scopeView);
    const resolvedTheme = resolveTheme(opts.initialSettings.theme, view);
    applyTheme(resolvedTheme, modal);

    // #26 — live re-apply when the user's effective theme is `'system'`
    // and the OS prefers-color-scheme flips. Track the current setting
    // in a closure so the matchMedia change handler can short-circuit
    // when the user has picked an explicit override (a user who chose
    // Light does NOT want the OS to override them).
    //
    // `currentTheme` reflects the SETTING value (`'system' | ThemeId`),
    // not the resolved value, so the gate stays accurate across
    // settings.theme → 'system' ↔ explicit transitions.
    let currentTheme: ThemeId | 'system' = opts.initialSettings.theme;
    const installSystemThemeListener = (): void => {
      if (uninstallSystemThemeListener) return;
      let mql: MediaQueryList;
      try {
        mql = view.matchMedia('(prefers-color-scheme: dark)');
      } catch {
        // No matchMedia (jsdom without a stub, very old WebView). The
        // mount-time resolveTheme already chose a sensible fallback;
        // there is nothing to subscribe to.
        return;
      }
      const onChange = (): void => {
        // Belt-and-braces: the settings push path also detaches the
        // listener when transitioning away from 'system', but if a
        // change arrives in the same microtask we don't want to
        // re-apply against an explicit override.
        if (currentTheme !== 'system') return;
        applyTheme(resolveTheme('system', view), modal);
      };
      mql.addEventListener('change', onChange);
      uninstallSystemThemeListener = () => mql.removeEventListener('change', onChange);
    };
    const removeSystemThemeListener = (): void => {
      uninstallSystemThemeListener?.();
      uninstallSystemThemeListener = null;
    };
    if (currentTheme === 'system') installSystemThemeListener();

    // Local WPM is the source of truth for engine cadence while mounted.
    // Persisted settings updates push in via `subscribeSettings`; the
    // in-overlay ↑/↓ shortcut and slider input update `currentWpm` + the
    // engine and (when `onWpmChange` is wired) persist via the callback.
    let currentWpm = opts.initialSettings.wpm;

    // Single point of truth for keeping the slider + readout in sync with
    // `currentWpm`. Called from mount-time init, the ArrowUp/Down keyboard
    // handler, slider input, and subscribeSettings emissions.
    const syncWpmUi = (n: number): void => {
      wpmSlider.value = String(n);
      wpmReadout.textContent = OVERLAY_TEXT.wpmReadout(n);
    };
    syncWpmUi(currentWpm);

    // Font-size stepper (#29). Local cache so the subscribeSettings
    // handler can short-circuit no-op emissions and so the A−/A+
    // buttons read+clamp from a single source. The applyFontSize helper
    // also updates the boundary-disabled state on the buttons.
    let currentFontSize = opts.initialSettings.fontSize;
    const clampFontSize = (n: number): number => {
      // Defend against NaN/Infinity/negatives from caller-supplied
      // initialSettings (review M4): Math.max/min propagate NaN, so a
      // bare clamp here would still emit garbage CSS. Fall back to MIN.
      if (!Number.isFinite(n)) return FONT_SIZE_MIN;
      return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n));
    };
    const applyFontSize = (n: number): void => {
      currentFontSize = n;
      // Write the custom property on the modal ancestor rather than the
      // hot `word` element (review M3). `.word-region` reads
      // `var(--rsvp-font-size)` via CSS custom-property inheritance, so
      // moving the write up one level keeps the cascade working while
      // avoiding inline-style invalidation on every RSVP tick (~10 Hz
      // at 600 wpm).
      modal.style.setProperty('--rsvp-font-size', `${n}px`);
      fontDecBtn.disabled = n <= FONT_SIZE_MIN;
      fontIncBtn.disabled = n >= FONT_SIZE_MAX;
    };
    // Clamp at mount-time too (review M4) — subscribeSettings clamps but
    // initialSettings flows in unclamped from caller, so a bad value
    // (NaN, Infinity, negative) would otherwise write garbage CSS once.
    applyFontSize(clampFontSize(currentFontSize));

    unsubscribeSettings = opts.subscribeSettings((s) => {
      const resolved = resolveTheme(s.theme, view);
      applyTheme(resolved, modal);
      currentTheme = s.theme;
      if (s.theme === 'system') installSystemThemeListener();
      else removeSystemThemeListener();
      if (s.wpm !== currentWpm) {
        currentWpm = s.wpm;
        engine?.setWpm(s.wpm);
        syncWpmUi(s.wpm);
      }
      if (s.fontSize !== currentFontSize) {
        applyFontSize(clampFontSize(s.fontSize));
      }
    });

    const engineWords = scopeView ? scopeView.activeWords : opts.words;
    engine = opts.engineFactory({ words: engineWords, wpm: currentWpm });

    const reflectEngineState = (): void => {
      const s = engine?.state ?? 'idle';
      if (s === 'playing') {
        playPauseBtn.setAttribute('aria-pressed', 'true');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PAUSE_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PAUSE_GLYPH;
        playPauseBtn.disabled = false;
      } else if (s === 'paused') {
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PLAY_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PLAY_GLYPH;
        playPauseBtn.disabled = false;
      } else {
        // 'idle' or 'done'
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PLAY_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PLAY_GLYPH;
        playPauseBtn.disabled = s === 'done';
      }
    };

    const clearPreview = (): void => {
      // Idempotency guard — clearPreview can be called on every state
      // transition; skip the layout-touching property writes when the
      // node is already in the cleared state. Matters when callers fan
      // out (toggle, swap, paused-state seek-driven word emits) — the
      // hot path stays free of redundant DOM writes.
      if (preview.hidden && preview.firstChild === null) return;
      preview.hidden = true;
      // textContent='' removes children too, dropping the <strong>.
      preview.textContent = '';
    };

    // #20 — render the surrounding-sentence preview. Caller MUST gate
    // on `engine.state === 'paused'`. The internal early-return below
    // is belt-and-braces only; the per-word hot path should never reach
    // this function (perf-adversary F1 + scope-adversary F1).
    const renderPreview = (): void => {
      if (!engine) return;
      if (engine.state !== 'paused') {
        clearPreview();
        return;
      }
      const progress = engine.progress();
      if (progress.total === 0) {
        clearPreview();
        return;
      }
      const currentIndex = progress.index - 1;
      // Active stream: scopeView's activeWords reflects swap-to-full;
      // fall back to the legacy single-stream path when no scope.
      const activeWords = scopeView ? scopeView.activeWords : opts.words;
      const ctx = buildSentenceContext(activeWords, currentIndex);
      if (!ctx) {
        clearPreview();
        return;
      }
      // Build via textContent + a single appended <strong>. No innerHTML.
      clearPreview();
      const beforeText = ctx.before.length > 0 ? ctx.before.join(' ') + ' ' : '';
      const afterText = ctx.after.length > 0 ? ' ' + ctx.after.join(' ') : '';
      preview.appendChild(opts.doc.createTextNode(beforeText));
      const strong = opts.doc.createElement('strong');
      strong.className = OVERLAY_CLASS.CONTEXT_CURRENT;
      strong.textContent = ctx.current;
      preview.appendChild(strong);
      preview.appendChild(opts.doc.createTextNode(afterText));
      preview.hidden = false;
    };

    engine.subscribe((ev) => {
      if (ev.type === 'word') {
        renderWord(word, ev.word);
        ariaLive.textContent = ev.word;
        // Only re-render the preview if the just-emitted word landed
        // while the engine was already paused (paused-state seekTo emits
        // a replacement `word` event — see RsvpEngine.seekTo docs). On
        // the per-word PLAYING tick path we MUST skip the call entirely;
        // clearPreview's idempotency guard makes the no-op cheap, but
        // not calling it at all is cheaper still (perf-adversary F1).
        if (engine?.state === 'paused') renderPreview();
      } else if (ev.type === 'done') {
        reflectEngineState();
        // Done is reached by playback; the preview was never visible if
        // we were playing. If a future caller can land in `done` from a
        // paused state, the idempotent clearPreview below is the safety
        // net.
        clearPreview();
      }
    });
    // #25 — resume the engine at the saved session position. Idle seekTo
    // is silent and sets nextIndex; the subsequent `start()` then emits
    // exactly one word event for words[resume]. Running seekTo AFTER start
    // (the prior shape) emitted words[0] first, then a replacement for
    // words[resume] — the subscriber's aria-live wrote twice, which can
    // cause a screen-reader double-announce on resume. seekTo's own
    // finite-integer + range guards belt-and-brace the check below; the
    // conditional is here so we skip the no-op when there's nothing to
    // restore.
    const resume = opts.initialIndex;
    if (
      typeof resume === 'number' &&
      Number.isInteger(resume) &&
      resume > 0 &&
      resume < engineWords.length
    ) {
      engine.seekTo(resume);
    }
    engine.start();
    if (scopeView?.fallback === 'empty-selection') {
      // Overrides the word[0] textContent that fired via the subscribe
      // handler during engine.start(). The polite live-region status fires
      // once on mount; subsequent ticks resume the per-word announcement
      // pattern.
      ariaLive.textContent = OVERLAY_TEXT.EMPTY_SELECTION_FALLBACK;
    }
    reflectEngineState();
    renderPreview();

    const togglePlayPause = (): void => {
      if (!engine) return;
      if (engine.state === 'playing') {
        engine.pause();
      } else if (engine.state === 'paused') {
        engine.resume();
      } else {
        return;
      }
      reflectEngineState();
      renderPreview();
    };

    playPauseBtn.addEventListener('click', togglePlayPause);

    // #36 — tap-to-pause on touch-primary viewports. The combined query
    // (pointer: coarse) and (hover: none) is the WCAG-aligned touch-primary
    // signal: it excludes hybrid laptops whose touchscreen reports `coarse`
    // alongside a precise mouse (those still satisfy `hover: hover`). On
    // mouse viewports the listener is wired but the guard short-circuits,
    // so accidental clicks on the word region during text-selection
    // gestures do not pause the reader.
    const isTouchPrimary = (): boolean =>
      view.matchMedia('(pointer: coarse) and (hover: none)').matches;
    word.addEventListener('click', () => {
      if (!isTouchPrimary()) return;
      togglePlayPause();
    });

    const swapToFull = (): void => {
      if (!engine) return;
      if (!scopeView || scopeView.scope !== 'selection') return;

      const fullWords = opts.fullWords ?? [];
      const title = opts.articleTitle?.trim();
      const newHeader =
        title && title.length > 0 ? title : OVERLAY_TEXT.fullHeaderFallback(fullWords.length);

      // Render the first word of the full stream by start+pause-ing the
      // engine on the new stream. seekTo(0) on 'idle' is a silent
      // reposition (per engine docs) — no word event — so the word region
      // would stay empty without the start+pause pairing.
      if (engine.state === 'playing') engine.pause();
      engine.setWords(fullWords);
      if (fullWords.length > 0) {
        engine.start();
        if (engine.state === 'playing') engine.pause();
      }

      // Promote view-state to full and rewrite the header.
      scopeView = {
        scope: 'full',
        activeWords: fullWords,
        headerText: newHeader,
        showSwapBtn: false,
        fallback: null,
      };
      currentScope = 'full';
      header.textContent = newHeader;
      swapBtn?.remove();

      // The engine.start() emission above will have set ariaLive to
      // fullWords[0]; overwrite with the swap announcement so AT users hear
      // the transition not the first word.
      ariaLive.textContent = OVERLAY_TEXT.expandedAnnouncement(fullWords.length);

      reflectEngineState();
      renderPreview();
      playPauseBtn.focus();
    };

    swapBtn?.addEventListener('click', swapToFull);

    uninstallTrap = installFocusTrap(modal);
    // installFocusTrap auto-focuses the first DOM-order focusable (the
    // close button at top-right). Override to land on play/pause per
    // AC #16 — the user's single keystroke to start or pause must be the
    // initial tab target. Same JS task as the trap install, so no flash.
    playPauseBtn.focus();

    const close = () => unmount();
    closeBtn.addEventListener('click', close);

    // Font-size stepper handlers (#29). Apply locally for instant
    // visual feedback, then dispatch upstream so the chrome glue can
    // persist to chrome.storage.sync. The applied value is the clamped
    // result — buttons are also disabled at the boundary, so a
    // boundary-press is the no-op safety net for assistive tech that
    // ignores `disabled`.
    const stepFontSize = (delta: number): void => {
      const next = clampFontSize(currentFontSize + delta);
      if (next === currentFontSize) return;
      applyFontSize(next);
      opts.onFontSizeChange?.(next);
    };
    fontDecBtn.addEventListener('click', () => stepFontSize(-FONT_SIZE_STEP));
    fontIncBtn.addEventListener('click', () => stepFontSize(FONT_SIZE_STEP));
    // Plain clamp — native <input type="range"> already enforces min/max and
    // step on browser-driven events, and the keyboard ArrowUp/Down deltas are
    // always on the canonical grid. The previous `Number.isFinite` guard and
    // step-snap were dead paths in practice (ring review #21).
    const clampWpm = (n: number): number => Math.max(WPM_MIN, Math.min(WPM_MAX, n));
    // `persist` controls whether onWpmChange fires. Two callsites need
    // different answers:
    //   - slider `change` (commit) + subscribeSettings echo → persist: true
    //     (subscribeSettings goes through the no-op short-circuit so the
    //      echo back to storage stays a no-op).
    //   - stepWpm (ArrowUp/Down keyboard shortcut) → persist: false. The
    //     main contract on the keyboard shortcut is "update engine cadence
    //     without persisting"; issue #24 names the SLIDER as the persistence
    //     surface, not the keyboard.
    const applyWpm = (next: number, opts2: { persist: boolean }): void => {
      if (!engine) return;
      const clamped = clampWpm(next);
      if (clamped === currentWpm) return;
      currentWpm = clamped;
      engine.setWpm(clamped);
      syncWpmUi(clamped);
      if (opts2.persist) opts.onWpmChange?.(clamped);
    };
    // ArrowUp / ArrowDown — adjust engine cadence without persisting. Issue
    // #24 names the slider as the persistence surface; the keyboard
    // shortcut intentionally stays session-only so a user can probe faster
    // speeds with arrow keys without rewriting their saved default.
    const stepWpm = (delta: number): void => {
      applyWpm(currentWpm + delta, { persist: false });
    };

    // Prev / next sentence buttons (#23). seekToSentence handles state
    // transitions (idle = silent, paused = replacement word event, playing =
    // restart at new position) and short-circuits on no further boundary.
    prevSentenceBtn.addEventListener('click', () => {
      engine?.seekToSentence('prev');
    });
    nextSentenceBtn.addEventListener('click', () => {
      engine?.seekToSentence('next');
    });

    // WPM slider (#24). Split `input` vs `change`:
    //   - `input` fires ~60×/sec during drag — UI-only update (slider
    //     value, readout text, currentWpm cache). Calling engine.setWpm
    //     on every tick would `clearPending()` + `scheduleNext()` per
    //     tick, resetting the active word's remaining-time and stalling
    //     the RSVP stream while the user drags (ring review #21).
    //   - `change` fires on drag release / keyboard commit — push the
    //     final value through applyWpm so engine cadence + persistence
    //     happen once per discrete drag, not per tick.
    wpmSlider.addEventListener('input', () => {
      const raw = Number(wpmSlider.value);
      const clamped = clampWpm(raw);
      currentWpm = clamped;
      wpmSlider.value = String(clamped);
      wpmReadout.textContent = OVERLAY_TEXT.wpmReadout(clamped);
    });
    wpmSlider.addEventListener('change', () => {
      const raw = Number(wpmSlider.value);
      const clamped = clampWpm(raw);
      // Bypass applyWpm's currentWpm short-circuit: `input` has already
      // moved currentWpm to the dragged value, so applyWpm would no-op
      // and skip engine.setWpm + persistence. Call them directly here.
      if (!engine) return;
      engine.setWpm(clamped);
      // Keep the UI source of truth aligned with the committed value
      // (defensive — input handler already syncs).
      if (currentWpm !== clamped) {
        currentWpm = clamped;
        syncWpmUi(clamped);
      }
      opts.onWpmChange?.(clamped);
    });
    onKeydown = (e: KeyboardEvent) => {
      // Capture-phase handler installed on opts.doc — preventDefault denies
      // page-side hotkeys (YouTube Space, Docs arrows) while overlay owns
      // input. Modifier-key combos pass through so OS shortcuts like
      // Cmd+ArrowLeft (back) and Shift+ArrowRight (text selection) still
      // work.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine?.seekToSentence('prev');
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine?.seekToSentence('next');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        stepWpm(WPM_STEP);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepWpm(-WPM_STEP);
        return;
      }
    };
    opts.doc.addEventListener('keydown', onKeydown, true);

    status = 'mounted';
  }

  function unmount(): void {
    if (status === 'unmounted') return;
    uninstallTrap?.();
    uninstallTrap = null;
    if (onKeydown) opts.doc.removeEventListener('keydown', onKeydown, true);
    onKeydown = null;
    // #25 — capture progress + active scope BEFORE stopping the engine
    // so the host can build a session-resume snapshot. `engine.stop()`
    // does not reset `nextIndex`, so reading `progress()` after stop
    // would still work in practice, but capturing pre-stop keeps the
    // contract self-evident.
    let snapshot: OverlayCloseSnapshot | undefined;
    if (engine && currentScope) {
      const progress = engine.progress();
      if (progress.total > 0) {
        snapshot = {
          index: progress.index,
          total: progress.total,
          scope: currentScope,
        };
      }
    }
    engine?.stop();
    engine = null;
    currentScope = null;
    // #26 — drop the settings subscription BEFORE detaching the OS theme
    // listener. The settings callback can re-install the matchMedia
    // listener (when `s.theme === 'system'`); if we tore down matchMedia
    // first, a synchronous settings echo or microtask-drained emission
    // landing between the two calls would re-attach against a modal we're
    // about to remove, leaking a closure that pins the shadow root + engine.
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    uninstallSystemThemeListener?.();
    uninstallSystemThemeListener = null;
    host?.remove();
    host = null;
    if (priorOverflow !== null) {
      opts.doc.documentElement.style.overflow = priorOverflow;
      priorOverflow = null;
    }
    status = 'unmounted';
    opts.onClose?.(snapshot);
  }

  return {
    get status() {
      return status;
    },
    mount,
    unmount,
  };
}
