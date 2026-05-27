import { applyTheme } from '../theme';
import type { ThemeId } from '../theme';
import { OVERLAY_CSS } from './styles';
import type { OverlayHandle, OverlayOptions, OverlayStatus } from './types';
import type { RsvpEngine } from '../rsvp-engine';

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
  let onEscape: ((e: KeyboardEvent) => void) | null = null;

  function buildShadowTree(shadow: ShadowRoot): {
    modal: HTMLElement;
    word: HTMLElement;
    closeBtn: HTMLButtonElement;
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
    applyTheme(resolveTheme(opts.initialSettings.theme, opts.doc.defaultView!), modal);

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
