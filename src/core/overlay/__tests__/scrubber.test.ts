/**
 * scrubber.test.ts — issue #47
 *
 * Progress scrubber (Safari-parity time-labeled position control) wired
 * to the engine via the existing subscribe handler.
 *
 * Coverage:
 *  - DOM renders with `<input type="range">`, accessible label, numeric
 *    min/max/value/step, time labels visible at mount with pre-start values
 *  - subscribe handler updates scrubber value + labels + aria-valuetext on
 *    each `word` emission (Q4 — per-emission)
 *  - WPM subscribeSettings push refreshes time labels (timer math is
 *    WPM-dependent) without touching scrubber value/max
 *  - input event drives engine.seekTo with the integer value and pauses
 *    a playing engine
 *  - mousedown/touchstart pause a playing engine (interaction priming)
 *  - keyboard guard: ArrowLeft/Right on the scrubber does NOT fire
 *    engine.seekToSentence (native <input type="range"> owns the keys)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { OVERLAY_CLASS, OVERLAY_TEXT } from '../constants';

const STREAM = ['Hello.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
    subscribeSettings: () => () => undefined,
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
      return holder.engine;
    },
    ...overrides,
  };
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getScrubber(): HTMLInputElement {
  const el = getShadow().querySelector<HTMLInputElement>(`.${OVERLAY_CLASS.SCRUBBER_SLIDER}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-slider');
  return el;
}

function getElapsedLabel(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_ELAPSED}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-elapsed');
  return el;
}

function getRemainingLabel(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_REMAINING}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-remaining');
  return el;
}

function engineOf(holder: Holder): RsvpEngine {
  if (!holder.engine) throw new Error('engine not yet created');
  return holder.engine;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
});

describe('createOverlay — scrubber DOM (#47)', () => {
  test('renders <input type="range"> with accessible label + numeric attrs', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    expect(s.tagName).toBe('INPUT');
    expect(s.type).toBe('range');
    expect(s.getAttribute('aria-label')).toBe(OVERLAY_TEXT.SCRUBBER_LABEL);
    expect(s.min).toBe('0');
    expect(s.max).toBe(String(STREAM.length - 1));
    expect(s.step).toBe('1');
    expect(s.value).toBe('0');
    overlay.unmount();
  });

  test('mounts above the footer so visual order is word → preview → scrubber → controls', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const shadow = getShadow();
    const scrubberArea = shadow.querySelector(`.${OVERLAY_CLASS.SCRUBBER_AREA}`);
    const footer = shadow.querySelector(`.${OVERLAY_CLASS.FOOTER}`);
    if (!scrubberArea) throw new Error('expected scrubber-area in shadow');
    if (!footer) throw new Error('expected footer in shadow');
    // DOCUMENT_POSITION_FOLLOWING (4) ⇒ footer comes AFTER scrubber-area.
    const order = scrubberArea.compareDocumentPosition(footer);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    overlay.unmount();
  });

  test('post-mount labels reflect engine state after the synchronous first-word emission', () => {
    // engine.start() fires synchronously inside mount() and emits word[0],
    // so by the time we observe, progress.index === 1.
    //   wpm=300 ⇒ msPerWord=200; elapsed = 1*200=200ms → round → 0 → "0:00".
    //   remaining = 7*200=1400ms → round(1.4)=1 → "-0:01".
    //   value = max(0, 1-1) = 0.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(getScrubber().value).toBe('0');
    expect(getElapsedLabel().textContent).toBe('0:00');
    expect(getRemainingLabel().textContent).toBe('-0:01');
    expect(getScrubber().getAttribute('aria-valuetext')).toBe(OVERLAY_TEXT.scrubberValueText(0, 1));
    overlay.unmount();
  });
});

describe('createOverlay — scrubber engine wiring (#47)', () => {
  test('word emission advances scrubber value + updates labels + aria-valuetext', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    // First tick fires synchronously inside engine.start(); subsequent
    // ticks are setTimeout-scheduled. Pause after the first emission so
    // we can read a deterministic state.
    engineOf(holder).pause();
    // value = max(0, progress.index - 1) → 0 after the first emission
    const s = getScrubber();
    expect(s.value).toBe('0');
    // Advance to the third word programmatically via seekTo so we exercise
    // the paused-state replacement word emission's effect on the scrubber.
    //
    // Engine quirk worth pinning: in word mode, the paused-state seekTo
    // emits the replacement word event with `nextIndex === target`, then
    // bumps to `target + 1` AFTER the emit returns. The subscribe
    // handler reads `progress().index` DURING the emit, so it sees
    // `target` (here: 2), not `target + 1`. The scrubber formula
    // `value = max(0, index - 1)` therefore yields `1` on paused-seek
    // to 2 — the value reflects the raw position of the just-emitted
    // word, which is what we want visually anyway (thumb sits at the
    // token the user can see). A mutation that swapped the formula to
    // `value = index` would surface as scrubber-by-one drift across
    // both tick and paused-seek paths.
    engineOf(holder).seekTo(2);
    expect(s.value).toBe('1');
    // Elapsed at progress.index === 2 is 2 * 200ms = 400ms → "0:00"
    // (Math.round(0.4) === 0). Remaining: 6 * 200ms = 1200ms → "-0:01".
    expect(getElapsedLabel().textContent).toBe('0:00');
    expect(getRemainingLabel().textContent).toBe('-0:01');
    expect(s.getAttribute('aria-valuetext')).toBe(OVERLAY_TEXT.scrubberValueText(0, 1));
    overlay.unmount();
  });

  test('subscribeSettings wpm push refreshes time labels without touching value/max', () => {
    const holder: Holder = { engine: null };
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts(holder, {
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    engineOf(holder).pause();
    const beforeValue = getScrubber().value;
    const beforeMax = getScrubber().max;
    const next: OverlaySettings = { theme: 'system', wpm: 60, fontSize: 20 };
    notify(next);
    // After mount + pause, engine.progress().index === 1 (the first word
    // was emitted synchronously inside start()). wpm=60 → 1000ms/word.
    // remaining = (8 - 1) * 1000 = 7000ms → "-0:07".
    expect(getRemainingLabel().textContent).toBe('-0:07');
    expect(getScrubber().value).toBe(beforeValue);
    expect(getScrubber().max).toBe(beforeMax);
    overlay.unmount();
  });
});

describe('createOverlay — scrubber interaction (#47)', () => {
  test('input event invokes engine.seekTo with the integer value', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    const seekToSpy = vi.spyOn(engineOf(holder), 'seekTo');
    s.value = '4';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seekToSpy).toHaveBeenCalledWith(4, { snapToSentence: false });
    overlay.unmount();
  });

  test('input event pauses a playing engine (Safari spec — pause-on-scrub)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.value = '3';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('mousedown pauses a playing engine (interaction priming)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('touchstart pauses a playing engine (interaction priming)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.dispatchEvent(new Event('touchstart', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('non-finite input value is a no-op — does not corrupt engine state', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    const seekToSpy = vi.spyOn(engineOf(holder), 'seekTo');
    // Force-bypass the native input clamp by setting a value the browser
    // wouldn't normally surface, then dispatch. Since `s.value` is always
    // a string and Number('') === 0, simulate via setAttribute hack —
    // BUT the realistic mutation here is the Number guard's no-op path.
    // The contract is: even if the value is empty / garbage, we never
    // call seekTo with a NaN.
    Object.defineProperty(s, 'value', { configurable: true, get: () => 'not-a-number' });
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seekToSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });
});

describe('createOverlay — scrubber axis resync (#47 ring-review FIX-1)', () => {
  // Convergent HIGH (test-gap + extension-architect): scrubber.max was set
  // once at mount and never resynced. After scope-swap (selection →
  // fullWords), engine.progress().total changes but scrubber.max stayed
  // stale — browser clamped drag values while aria-valuetext kept advancing.
  // Fix: updateScrubber() now reads engine.progress().total each emission
  // and updates scrubber.max if it drifted. Mutation guard: removing the
  // resync block fails this test (max stays at 7 = selection.length - 1).
  test('scope-swap to full article resyncs scrubber.max to fullWords.length - 1', () => {
    const FULL = Array.from({ length: 30 }, (_, i) => `full${i}`);
    const SELECTION = ['Hello.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        scope: 'selection',
        selectionWords: SELECTION,
        fullWords: FULL,
        articleTitle: 'Doc',
      }),
    );
    overlay.mount();
    const s = getScrubber();
    expect(s.max).toBe(String(SELECTION.length - 1));
    // Trigger swap via the swap button (real interaction path).
    const swap = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.SCOPE_SWAP_BTN}`);
    if (!swap) throw new Error('expected scope-swap-btn');
    swap.click();
    // swapToFull calls engine.setWords(fullWords) then start() + pause(),
    // which synchronously emits word[0] → subscribe handler runs
    // updateScrubber() → reads engine.progress().total (now 30) → resyncs
    // scrubber.max to "29".
    expect(s.max).toBe(String(FULL.length - 1));
    overlay.unmount();
  });

  test('setChunkSize via subscribeSettings keeps scrubber.max stable (raw-axis mode invariance per #51)', () => {
    // The architect HIGH framing claimed setChunkSize would change the
    // axis. Confirmed by reading rsvp-engine.ts progress() (lines 853-877):
    // both word AND chunk mode report total === words.length. So
    // setChunkSize MUST NOT change scrubber.max. This test pins the
    // mode-invariance promise; a regression where the engine's progress
    // axis flipped to chunks.length in chunk mode would surface as
    // scrubber.max changing here.
    const holder: Holder = { engine: null };
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 1 },
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    const maxBefore = getScrubber().max;
    expect(maxBefore).toBe(String(STREAM.length - 1));
    notify({ theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 });
    expect(getScrubber().max).toBe(maxBefore);
    overlay.unmount();
  });
});

describe('createOverlay — scrubber done terminal state (#47 ring-review FIX-2)', () => {
  // test-gap HIGH #2: a regression that skipped updateScrubber() from the
  // `done` branch would leave the thumb mid-track and the remaining label
  // non-zero. Mutation guard: deleting `updateScrubber()` from the done
  // branch fails this test (value would stay at "0" and remaining at
  // "-0:01").
  test('engine.done leaves scrubber pinned at max with remaining = -0:00', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    // Advance through every scheduled tick until the engine emits 'done'.
    // STREAM has 8 words; first emits sync inside start(), remaining 7
    // via setTimeout. vi.runAllTimers drains both ticks AND the final
    // done emit (which is scheduled when tick() finds nextIndex >= total).
    vi.runAllTimers();
    expect(engineOf(holder).state).toBe('done');
    const s = getScrubber();
    expect(s.value).toBe(s.max);
    expect(getRemainingLabel().textContent).toBe('-0:00');
    // Elapsed = total * msPerWord = 8 * 200 = 1600ms → round → 2 → "0:02".
    expect(getElapsedLabel().textContent).toBe('0:02');
    overlay.unmount();
  });
});

describe('createOverlay — scrubber keyboard-only input pause (#47 ring-review FIX-3)', () => {
  // test-gap MED #2: the existing "input event pauses a playing engine"
  // test creates an input event but doesn't pin that NO preceding
  // mousedown fired. A regression that moved `scrubFromPause()` into a
  // mousedown-only branch would leave keyboard-driven scrub un-paused
  // (Arrow keys on the focused range fire `input` with no mousedown).
  // This test is explicit: input WITHOUT mousedown still pauses.
  test('input event with no preceding mousedown still pauses a playing engine (Arrow-key path)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.focus();
    // Simulate the Arrow-key path: the browser fires `input` directly on
    // a focused range when the user presses Arrow. No prior mousedown.
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });
});

describe('createOverlay — scrubber empty-stream guard (#47 ring-review FIX-4)', () => {
  // test-gap MED #3: empty word stream. Mutation guard: removing
  // `Math.max(0, ...-1)` at mount would allow max="-1" through. Browser
  // would clamp on render, but the attribute would lie. After FIX-1
  // adds dynamic resync, the same guard belongs in updateScrubber()
  // too; this test pins both surfaces.
  test('empty stream renders scrubber with max="0" and does not crash on update', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { words: [] }));
    overlay.mount();
    const s = getScrubber();
    expect(s.max).toBe('0');
    expect(s.value).toBe('0');
    // Engine on empty stream synchronously transitions to 'done' on start;
    // the done branch calls updateScrubber(). Confirm no throw + max stays 0.
    expect(engineOf(holder).state).toBe('done');
    expect(s.max).toBe('0');
    overlay.unmount();
  });
});

describe('createOverlay — scrubber live-region storm suppression (#47 ring-review FIX-6)', () => {
  // a11y MED #1: rapid scrub (mouse drag, touch swipe, Arrow held) emits
  // a paused-state replacement event per position; each emission wrote to
  // the polite aria-live region, queueing trailing speech AT users hear
  // AFTER they released. Fix: scrubInProgress flag + 250ms debounce; while
  // active, suppress per-emission ariaLive.textContent writes.
  // aria-valuetext on the slider still updates (the slider IS the ARIA
  // surface during scrub), so position feedback is preserved.
  test('rapid scrub events do NOT spam aria-live with each replacement word', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    // First scrub — establishes session + suppression announcement.
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    // Record the aria-live value after FIRST scrub. Subsequent scrubs
    // must NOT overwrite it with the replacement word's text.
    const liveAfterFirst = live.textContent;
    for (const v of ['3', '4', '5', '6']) {
      s.value = v;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // The per-emission word texts ("you?", "I", "am", "fine.") MUST NOT
    // have replaced the aria-live content during the scrub session.
    expect(live.textContent).toBe(liveAfterFirst);
    expect(STREAM).not.toContain(live.textContent);
    overlay.unmount();
  });

  test('after debounce window elapses, next normal emission DOES update aria-live', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    // Advance fake timer past the 250ms debounce window so scrubInProgress
    // clears.
    vi.advanceTimersByTime(300);
    // Now resume + emit a fresh word — aria-live should update again.
    engineOf(holder).resume();
    engineOf(holder).pause();
    engineOf(holder).seekTo(5);
    // Paused-state seekTo emits a replacement word; the subscribe handler
    // runs ariaLive write because scrubInProgress is false again.
    expect(live.textContent).toBe(STREAM[5]);
    overlay.unmount();
  });

  test('without any scrub interaction, normal playback emissions still update aria-live (back-compat)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    // engine.start() emits word[0] sync; aria-live should hold STREAM[0].
    expect(live.textContent).toBe(STREAM[0]);
    overlay.unmount();
  });
});

describe('createOverlay — scrubber pause-on-scrub announcement (#47 ring-review FIX-7)', () => {
  // a11y MED #2: pause-on-scrub silently flipped the play/pause button
  // label; ADHD readers needed explicit state-change confirmation. The
  // FIX-6 suppression flag ensures the announcement reaches AT before
  // the per-emission storm would clobber it.
  test('first scrub of a session announces "Paused. Scrubbing reading position." exactly once', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
  });

  test('multiple rapid scrubs do NOT re-fire the announcement within the same session', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
    // Wipe so we can observe if it re-fires.
    live.textContent = '';
    s.value = '3';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.value = '4';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    // FIX-6 suppression keeps the per-emission storm out; FIX-7 in-session
    // flag keeps the announcement from re-firing on every input.
    expect(live.textContent).toBe('');
  });

  test('after debounce + new scrub session, announcement fires again', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
    vi.advanceTimersByTime(300);
    live.textContent = '';
    s.value = '4';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
  });
});

describe('createOverlay — scrubber chunk-mode storm suppression (#47 round-2 ITEM-M3)', () => {
  // Round-1 FIX-6 added `if (!scrubInProgress)` guard on BOTH word AND chunk
  // branches (overlay.ts ~line 773), but the existing storm-suppression test
  // only exercises the word branch. A regression that dropped the chunk-branch
  // guard would leave the suite green while real chunk-mode users on rapid
  // scrub get the aria-live storm.
  //
  // Timing model (confirmed via rsvp-engine.ts `seekToChunk`, lines ~430-490):
  // in chunk mode the PAUSED-state `engine.seekTo(rawIdx)` snaps the raw word
  // index to its containing chunk and emits a replacement `chunk` event
  // (NOT `word`). So driving via the same `input`-on-scrubber path used by
  // the word-mode test naturally exercises the chunk branch — the scrubber's
  // input handler calls engine.seekTo(target), which in chunk mode emits a
  // chunk event into the same subscribe handler whose chunk-branch guard is
  // under test.
  test('rapid scrub events do NOT spam aria-live with each replacement chunk', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 },
      }),
    );
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    // First scrub — establishes session + suppression announcement. Lands
    // raw word index 2, which snaps to chunk[1] ("are you?" or similar
    // depending on tokenization of STREAM at chunkSize=2).
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    // Record the aria-live value after FIRST scrub (the SCRUB_PAUSED
    // announcement). Subsequent scrubs must NOT overwrite it with the
    // replacement chunk's text.
    const liveAfterFirst = live.textContent;
    expect(liveAfterFirst).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
    for (const v of ['3', '4', '5', '6']) {
      s.value = v;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // The per-emission chunk texts (e.g., "are you?", "I am", "fine. Bye!")
    // MUST NOT have replaced the aria-live content during the scrub
    // session. Mutation: dropping `if (!scrubInProgress)` from the chunk
    // branch in overlay.ts subscribe handler fails this assertion.
    expect(live.textContent).toBe(liveAfterFirst);
  });

  test('after debounce window elapses, next chunk emission DOES update aria-live (chunk-mode unblock)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 },
      }),
    );
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    s.focus();
    s.value = '2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    // Advance past 250ms debounce window so scrubInProgress clears.
    vi.advanceTimersByTime(300);
    // Now drive a fresh paused-state seekTo — the chunk branch should
    // write the replacement chunk text to aria-live because scrubInProgress
    // is false again. Use seekTo directly (not the scrubber input handler,
    // which would re-arm beginScrubSession and re-suppress).
    engineOf(holder).pause();
    live.textContent = '';
    engineOf(holder).seekTo(4);
    // Paused-state seekTo in chunk mode emits a `chunk` event; the
    // subscribe handler runs ariaLive write because scrubInProgress is
    // false again. aria-live should hold the replacement chunk text, not
    // empty string.
    expect(live.textContent).not.toBe('');
  });
});

describe('createOverlay — scrubber touch-path announcement (#47 round-2 ITEM-M1)', () => {
  // Touch device firing `touchstart` then synthetic `mousedown` then `input`
  // calls `beginScrubSession()` three times. Current behavior is correct
  // (announcement fires once via scrubAnnouncementFired latch) but a
  // regression that flipped `scrubAnnouncementFired = true` BEFORE the
  // textContent write would silently skip the first-session announce on
  // the touchstart path — the latch would already be true by the time the
  // subsequent `input` ran, and every existing test would still pass
  // (those start from `input` cold, never from `touchstart`).
  test('touchstart followed by input fires SCRUB_PAUSED_ANNOUNCEMENT exactly once on aria-live', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const live = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!live) throw new Error('missing aria-live');
    const s = getScrubber();
    // Use the same dispatch pattern as the existing touchstart-pause test
    // at line 237 — `new Event('touchstart', {bubbles: true})`. jsdom does
    // not constructor-support TouchEvent reliably; a plain Event is what
    // the existing scrubber listener (registered without checking event
    // class) accepts in production touch paths.
    s.dispatchEvent(new Event('touchstart', { bubbles: true }));
    // After touchstart: beginScrubSession ran; aria-live holds the
    // announcement; latch is true.
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
    // Now fire input — beginScrubSession runs again; latch already true,
    // so no re-fire. The seekTo replacement-word emission is suppressed
    // by scrubInProgress, so aria-live must STILL hold the announcement.
    s.value = '3';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.textContent).toBe(OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT);
    // Critical mutation guard: a regression that set scrubAnnouncementFired
    // = true BEFORE the textContent write inside beginScrubSession would
    // leave aria-live EMPTY here — touchstart's write would be skipped
    // (the early `if (!scrubAnnouncementFired)` would be false), and
    // input's write would also be skipped for the same reason. Asserting
    // exact equality with SCRUB_PAUSED_ANNOUNCEMENT (not per-emission word
    // STREAM[3] = "you?") catches both the missed announce AND any storm-
    // suppression regression that let the per-emission word through.
    expect(live.textContent).not.toBe(STREAM[3]);
    overlay.unmount();
  });
});

describe('createOverlay — scrubber keyboard guard (#47)', () => {
  test('ArrowLeft with scrubber focused does NOT call engine.seekToSentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    s.focus();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    s.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(spy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowRight with scrubber focused does NOT call engine.seekToSentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    s.focus();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    s.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(spy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowLeft on document body STILL calls engine.seekToSentence (guard is scrubber-scoped)', () => {
    // Mutation guard: a naive guard that ignores ALL ArrowLeft (not just
    // when target === scrubber) would silently break the global keyboard
    // shortcut. This test pins the scope of the guard.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    engineOf(holder).pause();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(spy).toHaveBeenCalledWith('prev');
    overlay.unmount();
  });
});
