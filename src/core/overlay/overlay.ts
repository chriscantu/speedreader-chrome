import { applyTheme } from '../theme';
import type { ThemeId } from '../theme';
import { OVERLAY_CSS } from './styles';
import type { OverlayHandle, OverlayOptions, OverlayScope, OverlayStatus } from './types';
import type { RsvpEngine } from '../rsvp-engine';
import { renderWord } from './word';
import { installFocusTrap } from './focus-trap';

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

const EMPTY_SELECTION_FALLBACK_TEXT = 'No selection detected. Reading full article instead.';

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
      headerText: `SELECTION · ${selectionWords.length} words · ~${formatSec(selectionWords.length)} sec`,
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
    headerText: title && title.length > 0 ? title : `Whole page — ${fullWords.length} words`,
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

const HOST_ATTR = 'data-speedreader-overlay';

export function createOverlay(opts: OverlayOptions): OverlayHandle {
  let status: OverlayStatus = 'unmounted';
  let host: HTMLElement | null = null;
  let engine: RsvpEngine | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let uninstallTrap: (() => void) | null = null;
  let onKeydown: ((e: KeyboardEvent) => void) | null = null;
  let priorOverflow: string | null = null;

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
    backdrop.className = 'backdrop';
    const modal = doc.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'sr-scope-header');

    const header = doc.createElement('h2');
    header.id = 'sr-scope-header';
    header.className = 'scope-header';
    header.textContent = scopeView?.headerText ?? 'SpeedReader';

    let subtitle: HTMLElement | null = null;
    if (scopeView?.fallback === 'empty-selection') {
      subtitle = doc.createElement('p');
      subtitle.className = 'scope-subtitle';
      subtitle.textContent = EMPTY_SELECTION_FALLBACK_TEXT;
    }

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

    const footer = doc.createElement('div');
    footer.className = 'footer';

    let swapBtn: HTMLButtonElement | null = null;
    if (scopeView?.showSwapBtn) {
      swapBtn = doc.createElement('button');
      swapBtn.className = 'scope-swap-btn';
      swapBtn.type = 'button';
      swapBtn.textContent = '← Full article';
      swapBtn.setAttribute('aria-label', 'Switch to full article');
      footer.appendChild(swapBtn);
    }

    const playPauseBtn = doc.createElement('button');
    playPauseBtn.className = 'play-pause-btn';
    playPauseBtn.type = 'button';
    footer.appendChild(playPauseBtn);

    const bottomSentinel = doc.createElement('div');
    bottomSentinel.className = 'trap-sentinel';
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
    const shadow = host.attachShadow({ mode: 'open' });
    const { modal, header, word, closeBtn, playPauseBtn, swapBtn, ariaLive } = buildShadowTree(
      shadow,
      scopeView,
    );
    const resolvedTheme = resolveTheme(opts.initialSettings.theme, view);
    applyTheme(resolvedTheme, modal);

    unsubscribeSettings = opts.subscribeSettings((s) => {
      const resolved = resolveTheme(s.theme, view);
      applyTheme(resolved, modal);
      // wpm change handling lands with #33/#118; MVP applies theme only.
    });

    const engineWords = scopeView ? scopeView.activeWords : opts.words;
    engine = opts.engineFactory({ words: engineWords, wpm: opts.initialSettings.wpm });

    const reflectEngineState = (): void => {
      const s = engine?.state ?? 'idle';
      if (s === 'playing') {
        playPauseBtn.setAttribute('aria-pressed', 'true');
        playPauseBtn.setAttribute('aria-label', 'Pause reading');
        playPauseBtn.textContent = '⏸ Pause';
        playPauseBtn.disabled = false;
      } else if (s === 'paused') {
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', 'Play reading');
        playPauseBtn.textContent = '▶ Play';
        playPauseBtn.disabled = false;
      } else {
        // 'idle' or 'done'
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', 'Play reading');
        playPauseBtn.textContent = '▶ Play';
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
    engine.start();
    if (scopeView?.fallback === 'empty-selection') {
      // Overrides the word[0] textContent that fired via the subscribe
      // handler during engine.start(). The polite live-region status fires
      // once on mount; subsequent ticks resume the per-word announcement
      // pattern.
      ariaLive.textContent = EMPTY_SELECTION_FALLBACK_TEXT;
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

    const swapToFull = (): void => {
      if (!engine) return;
      if (!scopeView || scopeView.scope !== 'selection') return;

      const fullWords = opts.fullWords ?? [];
      const title = opts.articleTitle?.trim();
      const newHeader =
        title && title.length > 0 ? title : `Whole page — ${fullWords.length} words`;

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
      header.textContent = newHeader;
      swapBtn?.remove();

      // The engine.start() emission above will have set ariaLive to
      // fullWords[0]; overwrite with the swap announcement so AT users hear
      // the transition not the first word.
      ariaLive.textContent = `Expanded to full article. Restarting from word 1 of ${fullWords.length}. Paused.`;

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
    onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        // Prevent page-scroll while the overlay owns the keyboard.
        e.preventDefault();
        togglePlayPause();
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
    engine?.stop();
    engine = null;
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    host?.remove();
    host = null;
    if (priorOverflow !== null) {
      opts.doc.documentElement.style.overflow = priorOverflow;
      priorOverflow = null;
    }
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
