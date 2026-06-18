import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { buildSentenceContext } from '../sentence-context';
import type { SentenceContext } from '../sentence-context';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

function expectCtx(ctx: SentenceContext | null): SentenceContext {
  if (ctx === null) throw new Error('expected SentenceContext, got null');
  return ctx;
}

describe('buildSentenceContext (#20 helper)', () => {
  test('mid-sentence: idx=1 in ["the","quick","brown","fox.","jumped","over."]', () => {
    const words = ['the', 'quick', 'brown', 'fox.', 'jumped', 'over.'];
    const ctx = expectCtx(buildSentenceContext(words, 1));
    expect(ctx.before).toEqual(['the']);
    expect(ctx.current).toBe('quick');
    expect(ctx.after).toEqual(['brown', 'fox.', 'jumped', 'over.']);
  });

  test('current word IS the sentence terminator: idx=3 ("fox.") → after starts at next sentence', () => {
    const words = ['the', 'quick', 'brown', 'fox.', 'jumped', 'over.', 'the', 'lazy'];
    const ctx = expectCtx(buildSentenceContext(words, 3, { nextLimit: 3 }));
    expect(ctx.current).toBe('fox.');
    expect(ctx.before).toEqual(['the', 'quick', 'brown']);
    // current word is terminator → after starts past it, capped at nextLimit
    expect(ctx.after).toEqual(['jumped', 'over.', 'the']);
  });

  test('stream start: idx=0 → before is empty', () => {
    const words = ['hello', 'world.', 'next'];
    const ctx = expectCtx(buildSentenceContext(words, 0));
    expect(ctx.before).toEqual([]);
    expect(ctx.current).toBe('hello');
    expect(ctx.after).toEqual(['world.', 'next']);
  });

  test('stream end: idx=length-1 → after is empty', () => {
    const words = ['one', 'two.', 'three', 'four'];
    const ctx = expectCtx(buildSentenceContext(words, 3));
    expect(ctx.current).toBe('four');
    expect(ctx.before).toEqual(['three']);
    expect(ctx.after).toEqual([]);
  });

  test('empty stream → null', () => {
    expect(buildSentenceContext([], 0)).toBeNull();
  });

  test('negative idx → null', () => {
    expect(buildSentenceContext(['a', 'b'], -1)).toBeNull();
  });

  test('out-of-range idx → null', () => {
    expect(buildSentenceContext(['a', 'b'], 5)).toBeNull();
  });

  test('non-integer idx → null', () => {
    expect(buildSentenceContext(['a', 'b'], 0.5)).toBeNull();
    expect(buildSentenceContext(['a', 'b'], Number.NaN)).toBeNull();
    expect(buildSentenceContext(['a', 'b'], Number.POSITIVE_INFINITY)).toBeNull();
  });

  test('nextLimit=1 truncates after to terminator + 1 word', () => {
    const words = ['a', 'b.', 'c', 'd', 'e', 'f'];
    const ctx = expectCtx(buildSentenceContext(words, 0, { nextLimit: 1 }));
    expect(ctx.current).toBe('a');
    expect(ctx.after).toEqual(['b.', 'c']); // terminator + 1
  });

  test('nextLimit=0 returns just the rest of the current sentence', () => {
    const words = ['a', 'b.', 'c', 'd'];
    const ctx = expectCtx(buildSentenceContext(words, 0, { nextLimit: 0 }));
    expect(ctx.after).toEqual(['b.']);
  });

  test('last sentence has no terminator: after extends to end of stream', () => {
    const words = ['intro.', 'tail', 'without', 'period'];
    const ctx = expectCtx(buildSentenceContext(words, 1));
    expect(ctx.current).toBe('tail');
    expect(ctx.before).toEqual([]);
    expect(ctx.after).toEqual(['without', 'period']);
  });

  test('"!" and "?" both end sentences (engine predicate parity)', () => {
    const ctxBang = expectCtx(buildSentenceContext(['hey!', 'next', 'word.'], 1));
    expect(ctxBang.before).toEqual([]);
    expect(ctxBang.current).toBe('next');
    const ctxQ = expectCtx(buildSentenceContext(['why?', 'next', 'word.'], 1));
    expect(ctxQ.before).toEqual([]);
    expect(ctxQ.current).toBe('next');
  });
});

// --------- Overlay integration ---------

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['the', 'quick', 'brown', 'fox.', 'jumped', 'over.', 'the', 'lazy', 'dog.'],
    // #242 — preview only shows when `contextLine` is enabled. These
    // legacy integration tests assert the show-on-pause behaviour, so they
    // opt the decoration in. The off-by-default path has its own block.
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20, contextLine: true },
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
    ...overrides,
  };
}

// #242 — the preview slot stays in flow at all times (no `display:none`,
// no `hidden` attribute) so toggling play/pause no longer reflows the
// modal. Visibility is carried by `visibility`/`opacity`. These helpers
// read the inline style the overlay writes.
function isPreviewVisible(preview: HTMLElement): boolean {
  return preview.style.visibility !== 'hidden' && preview.style.opacity !== '0';
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getPreview(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>('.context-preview');
  if (!el) throw new Error('overlay shadow: missing .context-preview');
  return el;
}

function getPlayPauseBtn(): HTMLButtonElement {
  const btn = getShadow().querySelector<HTMLButtonElement>('.play-pause-btn');
  if (!btn) throw new Error('overlay shadow: missing .play-pause-btn');
  return btn;
}

function getCurrentStrong(preview: HTMLElement): HTMLElement {
  const strong = preview.querySelector<HTMLElement>('strong.context-current');
  if (!strong) throw new Error('preview: missing strong.context-current');
  return strong;
}

describe('createOverlay — context preview (#20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('preview region exists with role=region and aria-label', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const preview = getPreview();
    expect(preview.getAttribute('role')).toBe('region');
    expect(preview.getAttribute('aria-label')).toBe('Surrounding sentence');
    overlay.unmount();
  });

  test('not visible while playing (initial state) — slot reserved, no hidden attribute', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const preview = getPreview();
    // #242 — slot stays in flow; the `hidden` attribute must never be used
    // (it pulls the element out of flow → the reflow this fix kills).
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.textContent).toBe('');
    overlay.unmount();
  });

  test('pause shows preview with <strong> wrapping the current word', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    // First word emitted on start → "the" at index 0.
    getPlayPauseBtn().click();

    const preview = getPreview();
    expect(isPreviewVisible(preview)).toBe(true);
    const strong = getCurrentStrong(preview);
    expect(strong.textContent).toBe('the');
    // Semantic emphasis — must be <strong>, not <b> / <span class=…>.
    // Mutation guard from test-gap-adversary F2: dropping the semantic
    // emphasis silently regresses screen-reader announcement.
    expect(strong.tagName).toBe('STRONG');
    // Surrounding sentence rendered: full first sentence ("the quick
    // brown fox.") + up to 3 next-sentence words.
    expect(preview.textContent).toContain('quick');
    expect(preview.textContent).toContain('fox.');
    // No raw HTML — <strong> is the ONLY element child.
    expect(preview.children.length).toBe(1);
    overlay.unmount();
  });

  test('resume hides preview and clears its content', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    btn.click(); // pause
    const preview = getPreview();
    expect(isPreviewVisible(preview)).toBe(true);

    btn.click(); // resume
    // #242 — visibility carries the play state; the slot stays in flow.
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(preview.textContent).toBe('');
    overlay.unmount();
  });

  test('pause at different word positions shows different previews', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    const preview = getPreview();

    // Pause #1 — engine just emitted index 0 = "the"
    btn.click();
    const firstWord = getCurrentStrong(preview).textContent;
    expect(firstWord).toBe('the');

    // Resume and advance ~one cadence so the engine emits the next word.
    btn.click();
    // At 300 wpm, msPerWord = 200ms. Advance to land on word index 1.
    vi.advanceTimersByTime(220);

    // Pause #2 — engine just emitted index 1 = "quick"
    btn.click();
    const secondWord = getCurrentStrong(preview).textContent;
    expect(secondWord).toBe('quick');
    expect(secondWord).not.toBe(firstWord);
    overlay.unmount();
  });

  test('done reached after pause hides the previously-visible preview', () => {
    // Original test only proved "preview hidden when engine was never
    // shown" — tautological with the initial-state test. Test-gap F3:
    // pause first (preview visible), then drive engine to done, assert
    // the preview was cleared on the done transition.
    const overlay = createOverlay(defaultOpts({ words: ['only.'] }));
    overlay.mount();
    const btn = getPlayPauseBtn();
    btn.click(); // pause — preview now visible
    const preview = getPreview();
    expect(isPreviewVisible(preview)).toBe(true);
    btn.click(); // resume
    // Advance past the single word so the engine ticks to done.
    vi.advanceTimersByTime(60000 / 300 + 5);
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(preview.textContent).toBe('');
    overlay.unmount();
  });

  test('after scope-swap, preview uses the full-article stream not the selection stream', () => {
    // Test-gap-adversary builder-self-weakness rank 1: scope-swap
    // preview source was untested. The overlay's preview must read
    // scopeView.activeWords, which `swapToFull` reassigns from
    // selectionWords to fullWords. A regression that captured words
    // at mount (instead of via the live ref) would silently render
    // selection context in the post-swap full-article view.
    const selectionWords = ['short', 'selection.'];
    const fullWords = ['the', 'quick', 'brown', 'fox.', 'jumped', 'over.'];
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        words: selectionWords,
        selectionWords,
        fullWords,
      }),
    );
    overlay.mount();
    const preview = getPreview();
    const swapBtn = getShadow().querySelector<HTMLButtonElement>('.scope-swap-btn');
    if (!swapBtn) throw new Error('overlay shadow: missing .scope-swap-btn');

    // Swap to full — `swapToFull` does start + pause, so the engine
    // lands paused on full[0] = "the" and `renderPreview()` fires
    // against the full stream. No extra click needed.
    swapBtn.click();

    const strong = getCurrentStrong(preview);
    expect(strong.textContent).toBe('the');
    // Preview must include a sibling word from the full sentence
    // ("quick"), proving the helper read `fullWords` not the prior
    // `selectionWords` (which has no "quick").
    expect(preview.textContent).toContain('quick');
    expect(preview.textContent).not.toContain('selection.');
    overlay.unmount();
  });

  test('preview built via textContent + <strong> only (no innerHTML injection surface)', () => {
    // Verify that even if a word contained "<script>" it would render
    // as text, not as DOM. This is structural — buildSentenceContext is
    // pure data, but the overlay renderer must never use innerHTML.
    const overlay = createOverlay(defaultOpts({ words: ['<script>x</script>', 'next.'] }));
    overlay.mount();
    getPlayPauseBtn().click(); // pause
    const preview = getPreview();
    // The script-like string must appear as plain text, never as a tag.
    expect(preview.querySelector('script')).toBeNull();
    const strong = getCurrentStrong(preview);
    expect(strong.textContent).toBe('<script>x</script>');
    overlay.unmount();
  });
});

describe('createOverlay — context preview reflow + contextLine gate (#242)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('play→pause→resume never toggles the hidden attribute or display:none (slot stays in flow)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    const preview = getPreview();

    // Initial (playing): slot reserved, no hidden attr, display untouched.
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(preview.style.display).not.toBe('none');

    btn.click(); // pause — visible
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(preview.style.display).not.toBe('none');
    expect(isPreviewVisible(preview)).toBe(true);

    btn.click(); // resume — hidden via visibility, NOT the hidden attribute
    expect(preview.hasAttribute('hidden')).toBe(false);
    expect(preview.style.display).not.toBe('none');
    expect(isPreviewVisible(preview)).toBe(false);

    overlay.unmount();
  });

  test('contextLine: false → preview never visible even when paused', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, contextLine: false },
      }),
    );
    overlay.mount();
    const preview = getPreview();
    expect(isPreviewVisible(preview)).toBe(false);

    getPlayPauseBtn().click(); // pause
    // The decoration is off → no preview content, slot stays invisible.
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.textContent).toBe('');
    expect(preview.querySelector('strong.context-current')).toBeNull();
    overlay.unmount();
  });

  test('contextLine undefined → treated as off (off-by-default schema intent)', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    const preview = getPreview();
    getPlayPauseBtn().click(); // pause
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.textContent).toBe('');
    overlay.unmount();
  });

  test('contextLine: true → preview visible on pause', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, contextLine: true },
      }),
    );
    overlay.mount();
    const preview = getPreview();
    getPlayPauseBtn().click(); // pause
    expect(isPreviewVisible(preview)).toBe(true);
    expect(getCurrentStrong(preview).textContent).toBe('the');
    overlay.unmount();
  });

  test('live subscribeSettings toggle of contextLine updates the preview without remount', () => {
    let push: ((s: OverlaySettings) => void) | undefined;
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, contextLine: false },
        subscribeSettings: (listener) => {
          push = listener;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    const preview = getPreview();
    getPlayPauseBtn().click(); // pause — still off, not visible
    expect(isPreviewVisible(preview)).toBe(false);

    // Enable contextLine live (paused) → preview appears, same DOM node.
    push?.({ theme: 'system', wpm: 300, fontSize: 20, contextLine: true });
    expect(isPreviewVisible(preview)).toBe(true);
    expect(getCurrentStrong(preview).textContent).toBe('the');

    // Disable live → preview hides again, slot still in flow.
    push?.({ theme: 'system', wpm: 300, fontSize: 20, contextLine: false });
    expect(isPreviewVisible(preview)).toBe(false);
    expect(preview.hasAttribute('hidden')).toBe(false);
    overlay.unmount();
  });
});

describe('buildSentenceContext — unified sentence predicate (#208)', () => {
  // Preview now shares `endsSentence` with the engine and chunk-mode
  // (`tokenize/sentence-boundary.ts`). Pre-#208 the naive `[.!?]$`
  // predicate made the preview disagree with chunk boundaries on
  // honorifics, ellipsis, and trailing closing quotes.

  test('honorific: "Dr." does not split the before-walk', () => {
    const ctx = buildSentenceContext(['Dr.', 'Smith', 'said', 'hi'], 3);
    // Naive predicate stops the backward walk at 'Dr.' → ['Smith', 'said'].
    expect(ctx?.before).toEqual(['Dr.', 'Smith', 'said']);
  });

  test('ellipsis terminates the after-walk', () => {
    const ctx = buildSentenceContext(['Wait…', 'Then', 'we', 'go', 'now', 'ok'], 0);
    // Current word is itself the terminator → after = next 3 words.
    // Naive predicate finds no terminator → after runs to end of stream.
    expect(ctx?.after).toEqual(['Then', 'we', 'go']);
  });

  test('terminator followed by closing quote ends the after-walk', () => {
    const ctx = buildSentenceContext(['He', 'said,', '"Stop."', 'And', 'then', 'more', 'words'], 1);
    // Terminator at index 2 → after = terminator + next 3 words.
    // Naive predicate misses the quoted terminator → after runs to end.
    expect(ctx?.after).toEqual(['"Stop."', 'And', 'then', 'more']);
  });

  test('CJK terminator splits the before-walk', () => {
    const ctx = buildSentenceContext(['你好。', '我们', '走吧'], 2);
    // '你好。' ends a sentence → before excludes it.
    expect(ctx?.before).toEqual(['我们']);
  });
});
