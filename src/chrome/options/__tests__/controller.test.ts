import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindOptionsForm, FIELD_IDS, type SettingsApi } from '../controller';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV4 } from '../../../core/settings/schema';

const HTML = `
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
  <input type="text" id="${FIELD_IDS.font}" />
  <input type="number" id="${FIELD_IDS.fontSize}" />
  <select id="${FIELD_IDS.alignment}">
    <option value="orp"></option>
    <option value="center"></option>
  </select>
  <input type="checkbox" id="${FIELD_IDS.openDyslexic}" />
  <input type="checkbox" id="${FIELD_IDS.punctuationPacing}" />
  <input type="checkbox" id="${FIELD_IDS.contextLine}" />
  <input type="checkbox" id="${FIELD_IDS.startFromWordOne}" />
  <div id="saved"></div>
`;

interface Stub extends SettingsApi {
  loadMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
  flushMock: ReturnType<typeof vi.fn>;
  subscribeMock: ReturnType<typeof vi.fn>;
  emit(s: SettingsV4): void;
}

function makeStub(initial: SettingsV4 = DEFAULT_SETTINGS): Stub {
  let listener: ((s: SettingsV4) => void) | null = null;
  const loadMock = vi.fn(async () => initial);
  const saveMock = vi.fn(async () => undefined);
  const flushMock = vi.fn(async () => undefined);
  const subscribeMock = vi.fn((cb: (s: SettingsV4) => void) => {
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

describe('options controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setBody(HTML);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('populates every editable field from loaded settings', async () => {
    const stub = makeStub({
      ...DEFAULT_SETTINGS,
      wpm: 350,
      theme: 'nord',
      font: 'Georgia',
      fontSize: 22,
      openDyslexic: true,
      punctuationPacing: false,
      alignment: 'center',
      contextLine: true,
      startFromWordOne: true,
    });
    await bindOptionsForm(document, window, stub);

    expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('350');
    expect((document.getElementById(FIELD_IDS.theme) as HTMLSelectElement).value).toBe('nord');
    expect((document.getElementById(FIELD_IDS.font) as HTMLInputElement).value).toBe('Georgia');
    expect((document.getElementById(FIELD_IDS.fontSize) as HTMLInputElement).value).toBe('22');
    expect((document.getElementById(FIELD_IDS.alignment) as HTMLSelectElement).value).toBe(
      'center',
    );
    expect((document.getElementById(FIELD_IDS.openDyslexic) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((document.getElementById(FIELD_IDS.punctuationPacing) as HTMLInputElement).checked).toBe(
      false,
    );
    expect((document.getElementById(FIELD_IDS.contextLine) as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById(FIELD_IDS.startFromWordOne) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('falls back to defaults when load rejects', async () => {
    const stub = makeStub();
    stub.loadMock.mockRejectedValueOnce(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await bindOptionsForm(document, window, stub);
    expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe(
      String(DEFAULT_SETTINGS.wpm),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('saves partial update on number change', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
    wpm.value = '400';
    fire(wpm, 'change');
    // Save call is sync-dispatched; resolution is microtask.
    await Promise.resolve();
    expect(stub.saveMock).toHaveBeenCalledWith({ wpm: 400 });
  });

  it('saves partial update on checkbox toggle', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    const cb = document.getElementById(FIELD_IDS.openDyslexic) as HTMLInputElement;
    cb.checked = true;
    fire(cb, 'change');
    await Promise.resolve();
    expect(stub.saveMock).toHaveBeenCalledWith({ openDyslexic: true });
  });

  it('saves partial update on select change', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    const theme = document.getElementById(FIELD_IDS.theme) as HTMLSelectElement;
    theme.value = 'sepia';
    fire(theme, 'change');
    await Promise.resolve();
    expect(stub.saveMock).toHaveBeenCalledWith({ theme: 'sepia' });
  });

  it('does NOT save when number input is NaN', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
    wpm.value = '';
    fire(wpm, 'change');
    await Promise.resolve();
    expect(stub.saveMock).not.toHaveBeenCalled();
  });

  it('repopulates from subscribe callback on external change', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    stub.emit({ ...DEFAULT_SETTINGS, wpm: 500, theme: 'dark' });
    expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('500');
    expect((document.getElementById(FIELD_IDS.theme) as HTMLSelectElement).value).toBe('dark');
  });

  it('flushes pending saves when document becomes hidden', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stub.flushMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT flush when document is still visible', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stub.flushMock).not.toHaveBeenCalled();
  });

  it('shows the saved indicator briefly after save resolves', async () => {
    const stub = makeStub();
    await bindOptionsForm(document, window, stub);
    const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
    wpm.value = '300';
    fire(wpm, 'change');
    // Await the save mock's returned promise + one extra microtask turn so the
    // `.then(() => showSaved)` chain runs before assertions.
    const saveResult = stub.saveMock.mock.results[0]?.value as Promise<void>;
    await saveResult;
    await Promise.resolve();
    expect(document.getElementById('saved')?.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(document.getElementById('saved')?.classList.contains('visible')).toBe(false);
  });

  it('teardown removes change listeners and unsubscribes', async () => {
    const stub = makeStub();
    const teardown = await bindOptionsForm(document, window, stub);
    teardown();
    const wpm = document.getElementById(FIELD_IDS.wpm) as HTMLInputElement;
    wpm.value = '450';
    fire(wpm, 'change');
    await Promise.resolve();
    expect(stub.saveMock).not.toHaveBeenCalled();
    // Emitting a subscribe update after teardown must be a no-op (listener cleared).
    stub.emit({ ...DEFAULT_SETTINGS, wpm: 600 });
    expect((document.getElementById(FIELD_IDS.wpm) as HTMLInputElement).value).toBe('450');
  });
});
