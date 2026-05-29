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
import { installFocusTrap } from './focus-trap';
import { WPM_MAX, WPM_MIN, WPM_STEP } from '../settings/bounds';

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
    ariaLive: HTMLElement;
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

    const playPauseBtn = doc.createElement('button');
    playPauseBtn.className = OVERLAY_CLASS.PLAY_PAUSE_BTN;
    playPauseBtn.type = 'button';
    footer.appendChild(playPauseBtn);

    const bottomSentinel = doc.createElement('div');
    bottomSentinel.className = OVERLAY_CLASS.TRAP_SENTINEL;
    bottomSentinel.tabIndex = 0;

    const children: Node[] = [topSentinel, closeBtn, header];
    if (subtitle) children.push(subtitle);
    children.push(word, ariaLive, footer, bottomSentinel);
    modal.append(...children);
    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);

    return { modal, header, word, closeBtn, playPauseBtn, swapBtn, ariaLive };
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
    const { modal, header, word, closeBtn, playPauseBtn, swapBtn, ariaLive } = buildShadowTree(
      shadow,
      scopeView,
    );
    const resolvedTheme = resolveTheme(opts.initialSettings.theme, view);
    applyTheme(resolvedTheme, modal);

    // Local WPM is the source of truth for engine cadence while mounted.
    // Persisted settings updates push in via `subscribeSettings`; the
    // in-overlay ↑/↓ shortcut updates `currentWpm` + the engine without
    // persisting.
    let currentWpm = opts.initialSettings.wpm;
    unsubscribeSettings = opts.subscribeSettings((s) => {
      const resolved = resolveTheme(s.theme, view);
      applyTheme(resolved, modal);
      if (s.wpm !== currentWpm) {
        currentWpm = s.wpm;
        engine?.setWpm(s.wpm);
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

    engine.subscribe((ev) => {
      if (ev.type === 'word') {
        renderWord(word, ev.word);
        ariaLive.textContent = ev.word;
      } else if (ev.type === 'done') {
        reflectEngineState();
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
    const stepWpm = (delta: number): void => {
      if (!engine) return;
      const next = Math.max(WPM_MIN, Math.min(WPM_MAX, currentWpm + delta));
      if (next === currentWpm) return;
      currentWpm = next;
      engine.setWpm(next);
    };
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
    unsubscribeSettings?.();
    unsubscribeSettings = null;
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
