/**
 * alignment-wire.test.ts — issue #52 PART A
 *
 * Wires `OverlaySettings.alignment` through to a `data-alignment` host
 * attribute. The schema slot existed at V6 but the overlay didn't read
 * it — switching to `'center'` was a silent no-op.
 *
 * Mutation guards:
 *   - Dropping the host.setAttribute('data-alignment', …) at mount fails
 *     the mount-time assertion.
 *   - Dropping the subscribeSettings alignment update fails the
 *     live-push assertion.
 *   - Defaulting to `'center'` (wrong default) fails the unspecified-
 *     setting test (must default to 'orp').
 *   - A regression that wrote the attribute on the modal (not the host)
 *     fails the host-attribute assertion.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_ATTR } from '../constants';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['Hello.', 'How', 'are', 'you?'],
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
    ...overrides,
  };
}

function getHost(): HTMLElement {
  const el = document.body.querySelector(`[${OVERLAY_ATTR.HOST}]`);
  if (!(el instanceof HTMLElement)) throw new Error('overlay host missing');
  return el;
}

describe('createOverlay — alignment wire-up (#52 PART A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.querySelectorAll(`[${OVERLAY_ATTR.HOST}]`).forEach((n) => n.remove());
    vi.useRealTimers();
  });

  test('mount with alignment="orp" writes data-alignment="orp" on host', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, alignment: 'orp' },
      }),
    );
    overlay.mount();
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('orp');
    overlay.unmount();
  });

  test('mount with alignment="center" writes data-alignment="center" on host', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, alignment: 'center' },
      }),
    );
    overlay.mount();
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('center');
    overlay.unmount();
  });

  test('mount with alignment omitted defaults to "orp"', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
      }),
    );
    overlay.mount();
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('orp');
    overlay.unmount();
  });

  test('subscribeSettings push from orp → center updates host attribute', () => {
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, alignment: 'orp' },
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('orp');
    const next: OverlaySettings = {
      theme: 'system',
      wpm: 300,
      fontSize: 20,
      alignment: 'center',
    };
    notify(next);
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('center');
    overlay.unmount();
  });

  test('subscribeSettings echo with same alignment does not churn the attribute', () => {
    // No observable side-effect to assert beyond "no throw and value stays
    // the same" — but a regression that always re-wrote the attribute would
    // still pass this; the guard is the explicit currentAlignment !==
    // s.alignment short-circuit in overlay.ts. This test pins the contract
    // that echo emissions are tolerated.
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, alignment: 'center' },
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    notify({ theme: 'system', wpm: 300, fontSize: 20, alignment: 'center' });
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('center');
    overlay.unmount();
  });
});

describe('OVERLAY_CSS — alignment selectors (#52 PART A)', () => {
  test('stylesheet scopes a word-run grid under :host([data-alignment="orp"])', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // The orp branch must define the 3-column grid on .word-run so the
    // focus character anchors at the center column across successive runs.
    expect(OVERLAY_CSS).toMatch(
      /:host\(\[data-alignment="orp"\]\)\s+\.word-run\s*\{[^}]*display:\s*grid/,
    );
    expect(OVERLAY_CSS).toMatch(
      /:host\(\[data-alignment="orp"\]\)\s+\.word-run\s*\{[^}]*grid-template-columns:\s*1fr\s+auto\s+1fr/,
    );
  });

  test('stylesheet scopes a centered layout under :host([data-alignment="center"])', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // Center mode must override the orp grid by reverting display on
    // .word-run. The `text-align: center` on the parent .word-region
    // continues to centre the inline content.
    expect(OVERLAY_CSS).toMatch(
      /:host\(\[data-alignment="center"\]\)\s+\.word-run\s*\{[^}]*display:\s*block/,
    );
  });
});
