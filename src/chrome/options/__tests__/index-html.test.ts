/**
 * Structural smoke test for the options-page HTML.
 *
 * The controller test (`controller.test.ts`) uses its own minimal HTML
 * fixture, so a regression in `index.html` (missing section, dropped
 * field, broken label association) would not be caught there. This file
 * loads the real `index.html` from disk and asserts the structural
 * invariants required by issue #30:
 *
 *  - Four sections: Speed, Appearance, Pacing, Shortcuts
 *  - Every editable FIELD_IDS entry is present in the DOM
 *  - Every form control has an associated <label> with the expected text
 *  - Shortcuts card lists the bindings exposed by the manifest +
 *    overlay keydown handler, with the toggle chord tied to the manifest
 *    default (so a manifest rebind that this card doesn't follow fails
 *    the suite)
 *  - End-to-end controller bind against the real HTML — guards the gap
 *    where `controller.test.ts`'s synthetic fixture would mask HTML drift
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bindOptionsForm, FIELD_IDS, type SettingsApi } from '../controller';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV7 } from '../../../core/settings/schema';
import manifest from '../../manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(HERE, '../index.html');

// Toggle chord pulled from the manifest so a rebind of
// commands._toggle_reader propagates here — the card must follow.
const TOGGLE_DEFAULT_CHORD = manifest.commands._toggle_reader.suggested_key.default;
const TOGGLE_MAC_CHORD = manifest.commands._toggle_reader.suggested_key.mac;

describe('options index.html structure', () => {
  let doc: Document;

  beforeAll(() => {
    // Vitest env is jsdom, so window.DOMParser is available. Going through
    // DOMParser instead of `import 'jsdom'` keeps the test off the
    // ambient-types dependency the build's tsc pass would flag.
    const html = readFileSync(HTML_PATH, 'utf8');
    doc = new DOMParser().parseFromString(html, 'text/html');
  });

  describe('sections (issue #30)', () => {
    it.each([
      ['speed', 'Speed'],
      ['appearance', 'Appearance'],
      ['pacing', 'Pacing'],
      ['privacy', 'Privacy'],
      ['shortcuts', 'Shortcuts'],
    ])('renders the %s section with legend "%s"', (key, legendText) => {
      const section = doc.querySelector<HTMLFieldSetElement>(`fieldset[data-section="${key}"]`);
      expect(section, `missing section data-section="${key}"`).not.toBeNull();
      const legend = section?.querySelector('legend');
      expect(legend?.textContent?.trim()).toBe(legendText);
    });

    it('renders the five sections (issue #30 + #49 privacy section)', () => {
      // No production code reads section order; the per-section it.each above
      // already proves presence + placement. Set-equality avoids overspecifying.
      const sections = new Set(
        Array.from(doc.querySelectorAll('fieldset[data-section]')).map((el) =>
          el.getAttribute('data-section'),
        ),
      );
      expect(sections).toEqual(new Set(['speed', 'appearance', 'pacing', 'privacy', 'shortcuts']));
    });
  });

  describe('field coverage', () => {
    it.each(Object.entries(FIELD_IDS))('renders an element for FIELD_IDS.%s (#%s)', (_, id) => {
      const el = doc.getElementById(id);
      expect(el, `missing element #${id}`).not.toBeNull();
    });

    it('places wpm under Speed', () => {
      const section = doc.querySelector('fieldset[data-section="speed"]');
      expect(section?.querySelector(`#${FIELD_IDS.wpm}`)).not.toBeNull();
    });

    it.each([
      ['theme', FIELD_IDS.theme],
      ['font', FIELD_IDS.font],
      ['fontSize', FIELD_IDS.fontSize],
      ['alignment', FIELD_IDS.alignment],
      ['contextLine', FIELD_IDS.contextLine],
      ['chunkSize', FIELD_IDS.chunkSize],
    ])('places %s under Appearance', (_, id) => {
      const section = doc.querySelector('fieldset[data-section="appearance"]');
      expect(section?.querySelector(`#${id}`)).not.toBeNull();
    });

    it.each([
      ['punctuationPacing', FIELD_IDS.punctuationPacing],
      ['startFromWordOne', FIELD_IDS.startFromWordOne],
    ])('places %s under Pacing', (_, id) => {
      const section = doc.querySelector('fieldset[data-section="pacing"]');
      expect(section?.querySelector(`#${id}`)).not.toBeNull();
    });
  });

  describe('accessibility — label association', () => {
    // Expected label text per field. Tightening from `not.toBe('')` (which
    // accepts e.g. `<label>.</label>` — WCAG theater) to a per-field map
    // catches both empty AND meaningless labels.
    const EXPECTED_LABELS: Record<keyof typeof FIELD_IDS, string> = {
      wpm: 'Words per minute',
      theme: 'Theme',
      font: 'Font',
      fontSize: 'Font size (px)',
      alignment: 'Word alignment',
      punctuationPacing: 'Slow down at punctuation',
      contextLine: 'Show line of context around current word',
      startFromWordOne: 'Always start from word one',
      historyEnabled: 'Remember recently read articles',
      chunkSize: 'Words per display',
      scrubberAutoHide: 'Hide the position bar during playback',
    };

    it.each(Object.entries(FIELD_IDS))(
      'control #%s has the expected <label for> text',
      (key, id) => {
        const label = doc.querySelector(`label[for="${id}"]`);
        expect(label, `no <label for="${id}">`).not.toBeNull();
        expect(label?.textContent?.trim()).toBe(EXPECTED_LABELS[key as keyof typeof FIELD_IDS]);
      },
    );
  });

  describe('shortcuts reference card', () => {
    it('renders a definition list inside the shortcuts section', () => {
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      expect(dl).not.toBeNull();
    });

    it('surfaces the toggle chord pulled from manifest._toggle_reader.suggested_key.default', () => {
      // If the manifest rebinds the default but the card doesn't follow,
      // this assertion fails. The Mac variant lives in the same row's <dd>;
      // asserting one chord per platform would require platform-detection
      // here, so we cover Mac via the dedicated assertion below.
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      const terms = Array.from(dl?.querySelectorAll('dt') ?? []).map((t) => t.textContent?.trim());
      expect(terms).toContain(TOGGLE_DEFAULT_CHORD);
    });

    it('documents the Mac toggle variant in the toggle row', () => {
      // The Mac variant rides on the toggle row's <dd> since Chrome MV3
      // surfaces it as a per-OS override, not a separate command. Match on
      // dd text so a future move to a dedicated row still passes.
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      const dds = Array.from(dl?.querySelectorAll('dd') ?? []).map((d) => d.textContent ?? '');
      expect(dds.some((text) => text.includes(TOGGLE_MAC_CHORD))).toBe(true);
    });

    it.each([
      // Overlay keydown literals in src/core/overlay/overlay.ts ~L630.
      // The handler uses raw 'ArrowLeft' / 'ArrowRight' / 'ArrowUp' /
      // 'ArrowDown' strings (no exported constants), so the card uses
      // the corresponding arrow glyphs and we assert the rendered text.
      'Space', // play/pause
      'Esc', // close
      '← / →', // ← / → previous / next sentence
      '↑ / ↓', // ↑ / ↓ increase / decrease speed
    ])('documents the %s shortcut', (chord) => {
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      const terms = Array.from(dl?.querySelectorAll('dt') ?? []).map((t) => t.textContent?.trim());
      expect(terms).toContain(chord);
    });

    it('shows a rebind caveat near the chord rows', () => {
      const caveat = doc.querySelector(
        'fieldset[data-section="shortcuts"] [data-shortcuts-caveat]',
      );
      expect(caveat, 'missing rebind caveat element').not.toBeNull();
      expect(caveat?.textContent ?? '').toMatch(/yours may differ/i);
    });

    it('links to chrome://extensions/shortcuts for rebinding', () => {
      const link = doc.querySelector<HTMLAnchorElement>(
        'fieldset[data-section="shortcuts"] a[href="chrome://extensions/shortcuts"]',
      );
      expect(link).not.toBeNull();
    });
  });

  describe('font attribution (#191)', () => {
    it('credits OpenDyslexic with author and license as accessible text', () => {
      const credit = doc.querySelector('[data-font-attribution]');
      expect(credit, 'missing [data-font-attribution] element').not.toBeNull();
      expect(credit?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'OpenDyslexic font © Abbie Gonzalez, SIL OFL 1.1.',
      );
      // Must be perceivable by AT — normal text, not decorative.
      expect(credit?.getAttribute('aria-hidden')).toBeNull();
      expect(credit?.closest('[aria-hidden="true"]')).toBeNull();
    });
  });

  describe('responsive scaffolding', () => {
    it('declares a viewport meta tag', () => {
      const viewport = doc.querySelector('meta[name="viewport"]');
      expect(viewport?.getAttribute('content')).toMatch(/width=device-width/);
    });

    it('keeps the legacy load-error banner contract', () => {
      // The controller flips this element's `.visible` class on load
      // failure; the structural contract must survive any CSS rework.
      expect(doc.getElementById('load-error-banner')).not.toBeNull();
    });

    it('keeps the legacy toast contract (saved + save-error)', () => {
      expect(doc.getElementById('saved')).not.toBeNull();
      expect(doc.getElementById('save-error')).not.toBeNull();
    });
  });

  /**
   * Integration: drive `bindOptionsForm` against the real index.html.
   *
   * Critical because `controller.test.ts` uses a synthetic flat-fixture
   * string built from FIELD_IDS — self-referential, so a missing ID or
   * structural mismatch in the shipped HTML would not be caught there.
   * Mutation check: renaming `id="wpm"` to `id="wpm-input"` in
   * index.html (without touching FIELD_IDS) MUST make the missing-field
   * assertion below go red.
   */
  describe('controller binds against real index.html', () => {
    function makeStubApi(initial: SettingsV7 = DEFAULT_SETTINGS): SettingsApi & {
      loadMock: ReturnType<typeof vi.fn>;
      saveMock: ReturnType<typeof vi.fn>;
      flushMock: ReturnType<typeof vi.fn>;
    } {
      const loadMock = vi.fn(async () => initial);
      const saveMock = vi.fn(async () => undefined);
      const flushMock = vi.fn(async () => undefined);
      return {
        load: loadMock,
        save: saveMock,
        flush: flushMock,
        subscribe: () => () => undefined,
        loadMock,
        saveMock,
        flushMock,
      };
    }

    beforeEach(() => {
      const html = readFileSync(HTML_PATH, 'utf8');
      document.documentElement.innerHTML = new DOMParser().parseFromString(
        html,
        'text/html',
      ).documentElement.innerHTML;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('populates a loaded value into the real DOM', async () => {
      const api = makeStubApi({ ...DEFAULT_SETTINGS, wpm: 420, theme: 'nord' });
      await bindOptionsForm(document, window, api);
      expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('420');
      expect((document.getElementById(FIELD_IDS.theme) as HTMLSelectElement).value).toBe('nord');
    });

    it('round-trips a change event through to api.save', async () => {
      const api = makeStubApi();
      await bindOptionsForm(document, window, api);
      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '400';
      wpm.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      expect(api.saveMock).toHaveBeenCalledWith({ wpm: 400 });
    });

    it('console-errors with the missing field name when an id is dropped from real HTML', async () => {
      // Mutation surface: dropping #wpm from the shipped HTML must surface
      // via console.error. Equivalent to renaming id="wpm" → id="wpm-input"
      // without updating FIELD_IDS — same observable signal.
      document.getElementById(FIELD_IDS.wpm)?.remove();
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const api = makeStubApi();
      await bindOptionsForm(document, window, api);
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining('HTML missing field elements'),
        expect.arrayContaining(['wpm']),
      );
      err.mockRestore();
    });
  });
});
