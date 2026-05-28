import type { SettingsV4 } from '../../core/settings/schema';
import { DEFAULT_SETTINGS } from '../../core/settings/defaults';

/**
 * Settings surface the controller depends on. Mirrors the chrome storage
 * adapter (`src/chrome/settings/storage.ts`) but typed as an interface so the
 * options page can be unit-tested with a stub.
 */
export interface SettingsApi {
  load(): Promise<SettingsV4>;
  save(partial: Partial<Omit<SettingsV4, 'version' | 'lastUsedWpm'>>): Promise<void>;
  flush(): Promise<void>;
  subscribe(listener: (s: SettingsV4) => void): () => void;
}

/**
 * IDs the options page HTML form is required to expose. Centralised so the
 * binder, the HTML, and the tests cannot drift. `lastUsedWpm` is omitted —
 * it's a context-menu artifact, not user-editable.
 */
export const FIELD_IDS = {
  wpm: 'wpm',
  theme: 'theme',
  font: 'font',
  fontSize: 'fontSize',
  openDyslexic: 'openDyslexic',
  punctuationPacing: 'punctuationPacing',
  alignment: 'alignment',
  contextLine: 'contextLine',
  startFromWordOne: 'startFromWordOne',
} as const;

const SAVED_INDICATOR_ID = 'saved';
const SAVED_INDICATOR_MS = 1500;

type EditableField = keyof typeof FIELD_IDS;

function getInput(doc: Document, id: string): HTMLInputElement | HTMLSelectElement | null {
  const el = doc.getElementById(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el;
  return null;
}

function populate(doc: Document, s: SettingsV4): void {
  const wpm = getInput(doc, FIELD_IDS.wpm);
  if (wpm) wpm.value = String(s.wpm);

  const theme = getInput(doc, FIELD_IDS.theme);
  if (theme) theme.value = s.theme;

  const font = getInput(doc, FIELD_IDS.font);
  if (font) font.value = s.font;

  const fontSize = getInput(doc, FIELD_IDS.fontSize);
  if (fontSize) fontSize.value = String(s.fontSize);

  const openDyslexic = getInput(doc, FIELD_IDS.openDyslexic);
  if (openDyslexic instanceof HTMLInputElement) openDyslexic.checked = s.openDyslexic;

  const punctuation = getInput(doc, FIELD_IDS.punctuationPacing);
  if (punctuation instanceof HTMLInputElement) punctuation.checked = s.punctuationPacing;

  const alignment = getInput(doc, FIELD_IDS.alignment);
  if (alignment) alignment.value = s.alignment;

  const ctxLine = getInput(doc, FIELD_IDS.contextLine);
  if (ctxLine instanceof HTMLInputElement) ctxLine.checked = s.contextLine;

  const startOne = getInput(doc, FIELD_IDS.startFromWordOne);
  if (startOne instanceof HTMLInputElement) startOne.checked = s.startFromWordOne;
}

function showSaved(doc: Document, win: Window): void {
  const el = doc.getElementById(SAVED_INDICATOR_ID);
  if (!el) return;
  el.classList.add('visible');
  win.setTimeout(() => el.classList.remove('visible'), SAVED_INDICATOR_MS);
}

interface FieldReader {
  read(el: HTMLInputElement | HTMLSelectElement): SettingsV4[EditableField] | null;
}

function readNumberOrNull(el: HTMLInputElement | HTMLSelectElement): number | null {
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : null;
}

const FIELD_READERS: Record<EditableField, FieldReader> = {
  wpm: { read: readNumberOrNull },
  theme: {
    read: (el) => {
      const v = el.value as SettingsV4['theme'];
      return v;
    },
  },
  font: { read: (el) => el.value },
  fontSize: { read: readNumberOrNull },
  openDyslexic: {
    read: (el) => (el instanceof HTMLInputElement ? el.checked : null),
  },
  punctuationPacing: {
    read: (el) => (el instanceof HTMLInputElement ? el.checked : null),
  },
  alignment: {
    read: (el) => {
      const v = el.value as SettingsV4['alignment'];
      return v;
    },
  },
  contextLine: {
    read: (el) => (el instanceof HTMLInputElement ? el.checked : null),
  },
  startFromWordOne: {
    read: (el) => (el instanceof HTMLInputElement ? el.checked : null),
  },
};

/**
 * Bind the options-page form to the settings API.
 *
 * Load → populate → wire change handlers → subscribe.
 *
 * Returns a teardown function (unsubscribe + remove listeners) for tests
 * and future hot-reload scenarios.
 */
export async function bindOptionsForm(
  doc: Document,
  win: Window,
  api: SettingsApi,
): Promise<() => void> {
  const initial = await api.load().catch((err) => {
    console.warn('[speedreader] options: load failed, using defaults', err);
    return { ...DEFAULT_SETTINGS };
  });
  populate(doc, initial);

  const listeners: Array<{ el: Element; type: string; handler: EventListener }> = [];
  const fields = Object.keys(FIELD_IDS) as EditableField[];

  for (const field of fields) {
    const el = getInput(doc, FIELD_IDS[field]);
    if (!el) continue;
    const handler = (): void => {
      const reader = FIELD_READERS[field];
      const value = reader.read(el);
      if (value === null) return;
      api
        .save({ [field]: value } as Partial<SettingsV4>)
        .then(() => showSaved(doc, win))
        .catch((err) => console.warn('[speedreader] options: save failed', err));
    };
    el.addEventListener('change', handler);
    listeners.push({ el, type: 'change', handler });
  }

  const unsubscribe = api.subscribe((s) => populate(doc, s));

  // Flush pending writes when the page is hidden so a close-before-debounce
  // does not drop the last change.
  const visibilityHandler = (): void => {
    if (doc.visibilityState === 'hidden') {
      api.flush().catch(() => undefined);
    }
  };
  doc.addEventListener('visibilitychange', visibilityHandler);

  return () => {
    listeners.forEach(({ el, type, handler }) => el.removeEventListener(type, handler));
    doc.removeEventListener('visibilitychange', visibilityHandler);
    unsubscribe();
  };
}
