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
 *  - Every form control has an associated <label> (WCAG 1.3.1, 4.1.2)
 *  - Shortcuts card lists the bindings exposed by the manifest +
 *    overlay keydown handler
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIELD_IDS } from '../controller';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(HERE, '../index.html');

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
      ['shortcuts', 'Shortcuts'],
    ])('renders the %s section with legend "%s"', (key, legendText) => {
      const section = doc.querySelector<HTMLFieldSetElement>(`fieldset[data-section="${key}"]`);
      expect(section, `missing section data-section="${key}"`).not.toBeNull();
      const legend = section?.querySelector('legend');
      expect(legend?.textContent?.trim()).toBe(legendText);
    });

    it('renders exactly the four sections specified by issue #30', () => {
      const sections = Array.from(doc.querySelectorAll('fieldset[data-section]')).map((el) =>
        el.getAttribute('data-section'),
      );
      expect(sections).toEqual(['speed', 'appearance', 'pacing', 'shortcuts']);
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
      ['openDyslexic', FIELD_IDS.openDyslexic],
      ['contextLine', FIELD_IDS.contextLine],
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
    it.each(Object.values(FIELD_IDS))('control #%s has an associated <label for>', (id) => {
      const label = doc.querySelector(`label[for="${id}"]`);
      expect(label, `no <label for="${id}">`).not.toBeNull();
      expect(label?.textContent?.trim()).not.toBe('');
    });
  });

  describe('shortcuts reference card', () => {
    it('renders a definition list inside the shortcuts section', () => {
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      expect(dl).not.toBeNull();
    });

    it.each([
      'Ctrl+Shift+Y', // toggle (matches manifest commands._toggle_reader)
      'Space', // play/pause (overlay keydown)
      'Esc', // close (overlay keydown)
    ])('documents the %s shortcut', (chord) => {
      const dl = doc.querySelector('fieldset[data-section="shortcuts"] dl.shortcuts');
      const terms = Array.from(dl?.querySelectorAll('dt') ?? []).map((t) => t.textContent?.trim());
      expect(terms).toContain(chord);
    });

    it('links to chrome://extensions/shortcuts for rebinding', () => {
      const link = doc.querySelector<HTMLAnchorElement>(
        'fieldset[data-section="shortcuts"] a[href="chrome://extensions/shortcuts"]',
      );
      expect(link).not.toBeNull();
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
});
