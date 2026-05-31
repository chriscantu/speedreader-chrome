import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindOptionsForm, FIELD_IDS, type SettingsApi } from '../controller';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV6 } from '../../../core/settings/schema';

const HTML = `
  <div id="load-error-banner"></div>
  <input type="number" id="${FIELD_IDS.wpm}" />
  <select id="${FIELD_IDS.theme}">
    <option value="system"></option>
    <option value="light"></option>
    <option value="dark"></option>
    <option value="sepia"></option>
    <option value="paper"></option>
    <option value="cream"></option>
    <option value="nord"></option>
  </select>
  <select id="${FIELD_IDS.font}">
    <option value="system"></option>
    <option value="opendyslexic"></option>
    <option value="newYork"></option>
    <option value="georgia"></option>
    <option value="menlo"></option>
  </select>
  <input type="number" id="${FIELD_IDS.fontSize}" />
  <select id="${FIELD_IDS.alignment}">
    <option value="orp"></option>
    <option value="center"></option>
  </select>
  <input type="checkbox" id="${FIELD_IDS.punctuationPacing}" />
  <input type="checkbox" id="${FIELD_IDS.contextLine}" />
  <input type="checkbox" id="${FIELD_IDS.startFromWordOne}" />
  <input type="checkbox" id="${FIELD_IDS.historyEnabled}" />
  <input type="checkbox" id="historyClearOnDisable" />
  <select id="${FIELD_IDS.chunkSize}">
    <option value="1"></option>
    <option value="2"></option>
    <option value="3"></option>
  </select>
  <div id="saved"></div>
  <div id="save-error"></div>
`;

interface Stub extends SettingsApi {
  loadMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
  flushMock: ReturnType<typeof vi.fn>;
  subscribeMock: ReturnType<typeof vi.fn>;
  emit(s: SettingsV6): void;
}

function makeStub(initial: SettingsV6 = DEFAULT_SETTINGS): Stub {
  let listener: ((s: SettingsV6) => void) | null = null;
  const loadMock = vi.fn(async () => initial);
  const saveMock = vi.fn(async () => undefined);
  const flushMock = vi.fn(async () => undefined);
  const subscribeMock = vi.fn((cb: (s: SettingsV6) => void) => {
    listener = cb;
    return () => {
      listener = null;
    };
  });
  return {
    load: loadMock,
    save: saveMock,
    flush: flushMock,
    subscribe: subscribeMock,
    loadMock,
    saveMock,
    flushMock,
    subscribeMock,
    emit(s) {
      listener?.(s);
    },
  };
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function fire(el: HTMLElement, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

describe('options controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setBody(HTML);
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('populate', () => {
    it('populates every editable field from loaded settings', async () => {
      const stub = makeStub({
        ...DEFAULT_SETTINGS,
        wpm: 350,
        theme: 'nord',
        font: 'georgia',
        fontSize: 22,
        openDyslexic: false,
        punctuationPacing: false,
        alignment: 'center',
        contextLine: true,
        startFromWordOne: true,
      });
      await bindOptionsForm(document, window, stub);

      expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('350');
      expect((document.getElementById(FIELD_IDS.theme) as HTMLSelectElement).value).toBe('nord');
      expect((document.getElementById(FIELD_IDS.font) as HTMLSelectElement).value).toBe('georgia');
      expect((document.getElementById(FIELD_IDS.fontSize) as HTMLInputElement).value).toBe('22');
      expect((document.getElementById(FIELD_IDS.alignment) as HTMLSelectElement).value).toBe(
        'center',
      );
      expect(
        (document.getElementById(FIELD_IDS.punctuationPacing) as HTMLInputElement).checked,
      ).toBe(false);
      expect((document.getElementById(FIELD_IDS.contextLine) as HTMLInputElement).checked).toBe(
        true,
      );
      expect(
        (document.getElementById(FIELD_IDS.startFromWordOne) as HTMLInputElement).checked,
      ).toBe(true);
    });

    it('migrates legacy openDyslexic=true into the font picker (#28)', async () => {
      // Pre-#28 payloads carry the boolean without a curated `font` value
      // (V4 default is `font: 'system-ui'` literal). The picker must snap
      // to 'opendyslexic' on first render so the user sees their effective
      // selection rather than a stale 'System' choice.
      const stub = makeStub({
        ...DEFAULT_SETTINGS,
        font: 'system-ui',
        openDyslexic: true,
      });
      await bindOptionsForm(document, window, stub);
      expect((document.getElementById(FIELD_IDS.font) as HTMLSelectElement).value).toBe(
        'opendyslexic',
      );
    });

    it('unknown legacy font literal falls back to system in the picker (#28)', async () => {
      const stub = makeStub({
        ...DEFAULT_SETTINGS,
        font: 'Comic Sans',
        openDyslexic: false,
      });
      await bindOptionsForm(document, window, stub);
      expect((document.getElementById(FIELD_IDS.font) as HTMLSelectElement).value).toBe('system');
    });

    it('legacy load does NOT auto-write the normalized payload (documented inconsistency)', async () => {
      // Documents the migration gap: when stored payload is legacy
      // `{ openDyslexic: true, font: 'system-ui' }`, the picker shows
      // 'opendyslexic' via `resolveFontId` on populate(), but the
      // controller does NOT write the normalized payload back to
      // storage. Normalization is effective only on the first user
      // interaction with the picker. If we ever decide to auto-write
      // on load, this test flips to assert `saveMock` WAS called.
      const stub = makeStub({
        ...DEFAULT_SETTINGS,
        font: 'system-ui',
        openDyslexic: true,
      });
      await bindOptionsForm(document, window, stub);
      expect(stub.saveMock).not.toHaveBeenCalled();
    });
  });

  describe('load failure (degraded mode)', () => {
    it('shows load-error banner and suppresses save when load rejects', async () => {
      const stub = makeStub();
      stub.loadMock.mockRejectedValueOnce(new Error('quota'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await bindOptionsForm(document, window, stub);

      expect(document.getElementById('load-error-banner')?.classList.contains('visible')).toBe(
        true,
      );
      // Defaults shown for orientation.
      expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe(
        String(DEFAULT_SETTINGS.wpm),
      );

      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '420';
      fire(wpm, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  });

  describe('save (per-field)', () => {
    it('saves wpm on valid in-range step-aligned change', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '400';
      fire(wpm, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ wpm: 400 });
    });

    it('saves checkbox toggle', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const cb = document.getElementById(FIELD_IDS.contextLine) as HTMLInputElement;
      cb.checked = true;
      fire(cb, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ contextLine: true });
    });

    it('saves theme select change', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const theme = document.getElementById(FIELD_IDS.theme) as HTMLSelectElement;
      theme.value = 'sepia';
      fire(theme, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ theme: 'sepia' });
    });

    it('saves alignment select change', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const align = document.getElementById(FIELD_IDS.alignment) as HTMLSelectElement;
      align.value = 'center';
      fire(align, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ alignment: 'center' });
    });

    it('saves font picker change WITHOUT mirroring the legacy openDyslexic boolean (#28)', async () => {
      // Read-side migration in `core/overlay/font-ids.ts#resolveFontId`
      // is the single source of truth for the legacy `openDyslexic`
      // boolean. The controller writes only the picker field — mirroring
      // the boolean here would create two write surfaces for the same
      // truth and (worse) silently mutate a field the user did not touch.
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const font = document.getElementById(FIELD_IDS.font) as HTMLSelectElement;
      font.value = 'georgia';
      fire(font, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ font: 'georgia' });
      // No openDyslexic key in the payload — mutation guard.
      const payload = stub.saveMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(payload && 'openDyslexic' in payload).toBe(false);
    });

    it('picking opendyslexic writes only the picker field (#28)', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const font = document.getElementById(FIELD_IDS.font) as HTMLSelectElement;
      font.value = 'opendyslexic';
      fire(font, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ font: 'opendyslexic' });
    });
  });

  describe('input validation (reject on invalid)', () => {
    it.each([
      ['empty string', ''],
      ['non-numeric', 'abc'],
      ['below min', '50'],
      ['above max', '999'],
      ['not step-aligned', '425'],
      ['non-integer', '250.5'],
    ])('rejects wpm: %s', async (_, raw) => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = raw;
      fire(wpm, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();
    });

    it.each([
      ['below min', '8'],
      ['above max', '99'],
      ['non-integer', '14.5'],
      ['empty', ''],
    ])('rejects fontSize: %s', async (_, raw) => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const fs = document.getElementById(FIELD_IDS.fontSize) as HTMLInputElement;
      fs.value = raw;
      fire(fs, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();
    });

    it('rejects theme value outside the V4 enum', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const theme = document.getElementById(FIELD_IDS.theme) as HTMLSelectElement;
      // Inject an option to simulate HTML drift; controller must reject.
      const option = document.createElement('option');
      option.value = 'rainbow';
      theme.appendChild(option);
      theme.value = 'rainbow';
      fire(theme, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();
    });

    it('rejects alignment value outside the V4 enum', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const align = document.getElementById(FIELD_IDS.alignment) as HTMLSelectElement;
      const option = document.createElement('option');
      option.value = 'left';
      align.appendChild(option);
      align.value = 'left';
      fire(align, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();
    });
  });

  describe('save failure UX', () => {
    it('flashes the save-error indicator when save rejects', async () => {
      const stub = makeStub();
      stub.saveMock.mockRejectedValueOnce(new Error('quota'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await bindOptionsForm(document, window, stub);
      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '300';
      fire(wpm, 'change');
      const saveResult = stub.saveMock.mock.results[0]?.value as Promise<unknown>;
      await saveResult.catch(() => undefined);
      await Promise.resolve();
      expect(document.getElementById('save-error')?.classList.contains('visible')).toBe(true);
      expect(document.getElementById('saved')?.classList.contains('visible')).toBe(false);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('flashes the saved indicator and clears it after the timeout', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '300';
      fire(wpm, 'change');
      const saveResult = stub.saveMock.mock.results[0]?.value as Promise<void>;
      await saveResult;
      await Promise.resolve();
      expect(document.getElementById('saved')?.classList.contains('visible')).toBe(true);
      vi.advanceTimersByTime(1600);
      expect(document.getElementById('saved')?.classList.contains('visible')).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('repopulates from subscribe callback on external change', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      stub.emit({ ...DEFAULT_SETTINGS, wpm: 500, theme: 'dark' });
      expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('500');
      expect((document.getElementById(FIELD_IDS.theme) as HTMLSelectElement).value).toBe('dark');
    });
  });

  describe('flush triggers', () => {
    it('flushes when document becomes hidden', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stub.flushMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT flush on visibilitychange when still visible', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stub.flushMock).not.toHaveBeenCalled();
    });

    it('flushes on pagehide regardless of visibility', async () => {
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      window.dispatchEvent(new Event('pagehide'));
      expect(stub.flushMock).toHaveBeenCalledTimes(1);
    });

    it('logs an error when flush rejects on visibility-hidden', async () => {
      const stub = makeStub();
      stub.flushMock.mockRejectedValueOnce(new Error('quota'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await bindOptionsForm(document, window, stub);
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('logs an error when flush rejects on pagehide', async () => {
      const stub = makeStub();
      stub.flushMock.mockRejectedValueOnce(new Error('quota'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await bindOptionsForm(document, window, stub);
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
      await Promise.resolve();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  });

  describe('HTML drift surfacing', () => {
    it('console-errors when a FIELD_IDS element is missing from the DOM', async () => {
      // Remove the wpm input to simulate HTML drift.
      document.getElementById(FIELD_IDS.wpm)?.remove();
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const stub = makeStub();
      await bindOptionsForm(document, window, stub);
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining('HTML missing field elements'),
        expect.arrayContaining(['wpm']),
      );
      err.mockRestore();
    });
  });

  // #49 — historyEnabled toggle + onHistoryDisabled side-effect hook.
  // The controller's settings data model is pure SettingsV6; the hook
  // is the bridge to the position-store wipe action wired in index.ts.
  describe('history toggle (#49)', () => {
    it('populates historyEnabled checkbox from loaded settings', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: true });
      await bindOptionsForm(document, window, stub);
      expect((document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it('saves historyEnabled on change like every other field', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: false });
      await bindOptionsForm(document, window, stub);
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = true;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ historyEnabled: true });
    });

    it('fires onHistoryDisabled when toggle transitions true → false (no companion checked)', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: true });
      const onHistoryDisabled = vi.fn();
      await bindOptionsForm(document, window, stub, onHistoryDisabled);
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = false;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(onHistoryDisabled).toHaveBeenCalledTimes(1);
      // Companion checkbox left unchecked — hook receives `false`.
      expect(onHistoryDisabled).toHaveBeenCalledWith(false);
    });

    it('passes alsoClearEntries=true when the companion checkbox is checked', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: true });
      const onHistoryDisabled = vi.fn();
      await bindOptionsForm(document, window, stub, onHistoryDisabled);
      // User ticks the "Also clear existing entries" companion FIRST,
      // then disables history. Hook should fire with true.
      (document.getElementById('historyClearOnDisable') as HTMLInputElement).checked = true;
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = false;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(onHistoryDisabled).toHaveBeenCalledWith(true);
    });

    it('does NOT fire onHistoryDisabled on false → true transition (only on disable)', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: false });
      const onHistoryDisabled = vi.fn();
      await bindOptionsForm(document, window, stub, onHistoryDisabled);
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = true;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(onHistoryDisabled).not.toHaveBeenCalled();
    });

    it('does NOT fire onHistoryDisabled twice when the user toggles off, on, off', async () => {
      // Each off transition must be observed independently; a stale
      // "lastHistoryEnabled" cache would either miss the second off
      // (false positive — hook silent on disable) or fire twice in a
      // row (false negative — hook fires on re-disable AND on the
      // initial subscribe re-render). Pin both.
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: true });
      const onHistoryDisabled = vi.fn();
      await bindOptionsForm(document, window, stub, onHistoryDisabled);
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = false;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(onHistoryDisabled).toHaveBeenCalledTimes(1);

      toggle.checked = true;
      fire(toggle, 'change');
      await Promise.resolve();
      // Still only the original disable.
      expect(onHistoryDisabled).toHaveBeenCalledTimes(1);

      toggle.checked = false;
      fire(toggle, 'change');
      await Promise.resolve();
      expect(onHistoryDisabled).toHaveBeenCalledTimes(2);
    });

    it('does NOT fire onHistoryDisabled when omitted from bindOptionsForm', async () => {
      // No hook supplied → the controller must not throw when the user
      // toggles off. Defaults still apply (no wipe).
      const stub = makeStub({ ...DEFAULT_SETTINGS, historyEnabled: true });
      await bindOptionsForm(document, window, stub /* no hook */);
      const toggle = document.getElementById(FIELD_IDS.historyEnabled) as HTMLInputElement;
      toggle.checked = false;
      expect(() => fire(toggle, 'change')).not.toThrow();
    });
  });

  describe('teardown', () => {
    it('removes listeners and unsubscribes', async () => {
      const stub = makeStub();
      const teardown = await bindOptionsForm(document, window, stub);
      teardown();

      const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
      wpm.value = '450';
      fire(wpm, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalled();

      stub.emit({ ...DEFAULT_SETTINGS, wpm: 600 });
      expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('450');

      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stub.flushMock).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      expect(stub.flushMock).not.toHaveBeenCalled();
    });
  });

  // #51 — chunk size select (1 | 2 | 3).
  describe('chunk size (#51)', () => {
    it('populates the chunkSize select from loaded settings', async () => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, chunkSize: 2 });
      await bindOptionsForm(document, window, stub);
      const select = document.getElementById(FIELD_IDS.chunkSize) as HTMLSelectElement;
      expect(select.value).toBe('2');
    });

    it.each([1, 2, 3] as const)('saves chunkSize=%d on change', async (n) => {
      const stub = makeStub({ ...DEFAULT_SETTINGS, chunkSize: 1 });
      await bindOptionsForm(document, window, stub);
      const select = document.getElementById(FIELD_IDS.chunkSize) as HTMLSelectElement;
      select.value = String(n);
      fire(select, 'change');
      await Promise.resolve();
      expect(stub.saveMock).toHaveBeenCalledWith({ chunkSize: n });
    });

    it('rejects an invalid chunkSize value at the boundary (HTML drift defense)', async () => {
      // Simulate HTML drift adding a "4" option. The reader's literal-set
      // gate MUST drop it so storage never sees a non-(1|2|3) value.
      const stub = makeStub({ ...DEFAULT_SETTINGS, chunkSize: 1 });
      await bindOptionsForm(document, window, stub);
      const select = document.getElementById(FIELD_IDS.chunkSize) as HTMLSelectElement;
      // Inject a rogue option and select it.
      const rogue = document.createElement('option');
      rogue.value = '4';
      select.appendChild(rogue);
      select.value = '4';
      fire(select, 'change');
      await Promise.resolve();
      expect(stub.saveMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ chunkSize: expect.anything() }),
      );
    });
  });
});
