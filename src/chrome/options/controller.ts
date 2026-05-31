import type { SettingsV6 } from '../../core/settings/schema';
import { DEFAULT_SETTINGS } from '../../core/settings/defaults';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  WPM_MAX,
  WPM_MIN,
  WPM_STEP,
} from '../../core/settings/bounds';
import { resolveFontId } from '../../core/overlay/font-ids';

export interface SettingsApi {
  load(): Promise<SettingsV6>;
  save(partial: Partial<Omit<SettingsV6, 'version' | 'lastUsedWpm'>>): Promise<void>;
  flush(): Promise<void>;
  subscribe(listener: (s: SettingsV6) => void): () => void;
}

/**
 * Optional side-effect hook (#49). Fires when the user TRANSITIONS the
 * `historyEnabled` toggle from true → false. The hook receives the
 * value of the companion "Also clear existing entries" checkbox so the
 * caller can decide whether to call `store.clearAll()`. Defined here
 * (not as a method on SettingsApi) so the chrome boundary stays clean:
 * SettingsApi is pure settings; this is a UX side-effect with no place
 * in the settings model.
 */
export type OnHistoryDisabled = (alsoClearEntries: boolean) => void;

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
  punctuationPacing: 'punctuationPacing',
  alignment: 'alignment',
  contextLine: 'contextLine',
  startFromWordOne: 'startFromWordOne',
  historyEnabled: 'historyEnabled',
  // #51 — chunk size select (1 | 2 | 3). Default 1 keeps today's
  // single-word display; opting into 2 or 3 enables multi-word RSVP.
  chunkSize: 'chunkSize',
} as const;

/**
 * Companion checkbox to `historyEnabled` (#49): when the user disables
 * history, optionally wipe the existing entries from the position store
 * at the same time. Default unchecked — turning the surface off is the
 * common case; nuking stored data is the destructive sub-action.
 *
 * This ID is read by `index.ts` (the chrome glue), NOT by the controller
 * — the controller's data model is `SettingsV6` only. The wipe call goes
 * to the position store directly.
 */
export const HISTORY_CLEAR_ON_DISABLE_ID = 'historyClearOnDisable';

const SAVED_INDICATOR_ID = 'saved';
const SAVE_ERROR_ID = 'save-error';
const LOAD_ERROR_BANNER_ID = 'load-error-banner';
const SAVED_INDICATOR_MS = 1500;
const SAVE_ERROR_MS = 4000;

type EditableField = keyof typeof FIELD_IDS;
type EditableValue<K extends EditableField> = SettingsV6[K];
type EditablePatch = Partial<Omit<SettingsV6, 'version' | 'lastUsedWpm'>>;

const THEME_VALUES = ['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord'] as const;
const ALIGNMENT_VALUES = ['orp', 'center'] as const;
const CHUNK_SIZE_VALUES = [1, 2, 3] as const;

function getInput(doc: Document, id: string): HTMLInputElement | HTMLSelectElement | null {
  const el = doc.getElementById(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el;
  return null;
}

function populate(doc: Document, s: SettingsV6): void {
  const wpm = getInput(doc, FIELD_IDS.wpm);
  if (wpm) wpm.value = String(s.wpm);

  const theme = getInput(doc, FIELD_IDS.theme);
  if (theme) theme.value = s.theme;

  // #28 — populate the picker with the resolved FontId so legacy V4
  // payloads carrying `openDyslexic: true` (and the V4 default
  // `font: 'system-ui'` literal) snap to the matching picker option on
  // first render. resolveFontId returns `'system'` for unknown literals,
  // which matches the picker default.
  const font = getInput(doc, FIELD_IDS.font);
  if (font) font.value = resolveFontId(s);

  const fontSize = getInput(doc, FIELD_IDS.fontSize);
  if (fontSize) fontSize.value = String(s.fontSize);

  const punctuation = getInput(doc, FIELD_IDS.punctuationPacing);
  if (punctuation instanceof HTMLInputElement) punctuation.checked = s.punctuationPacing;

  const alignment = getInput(doc, FIELD_IDS.alignment);
  if (alignment) alignment.value = s.alignment;

  const ctxLine = getInput(doc, FIELD_IDS.contextLine);
  if (ctxLine instanceof HTMLInputElement) ctxLine.checked = s.contextLine;

  const startOne = getInput(doc, FIELD_IDS.startFromWordOne);
  if (startOne instanceof HTMLInputElement) startOne.checked = s.startFromWordOne;

  const historyEnabled = getInput(doc, FIELD_IDS.historyEnabled);
  if (historyEnabled instanceof HTMLInputElement) historyEnabled.checked = s.historyEnabled;

  const chunkSize = getInput(doc, FIELD_IDS.chunkSize);
  if (chunkSize) chunkSize.value = String(s.chunkSize);
}

function flashIndicator(doc: Document, win: Window, id: string, ms: number): void {
  const el = doc.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  win.setTimeout(() => el.classList.remove('visible'), ms);
}

function showLoadErrorBanner(doc: Document): void {
  const el = doc.getElementById(LOAD_ERROR_BANNER_ID);
  if (!el) return;
  el.classList.add('visible');
}

/**
 * Per-field reader. `K` ties the element-read result to the exact
 * `SettingsV6[K]` slot so `theme`-shaped readers can't accidentally return
 * a number. Each reader returns `null` to reject invalid input — the binder
 * suppresses save on null, leaving the stored value untouched.
 */
type Reader<K extends EditableField> = (
  el: HTMLInputElement | HTMLSelectElement,
) => EditableValue<K> | null;

function readWpm(el: HTMLInputElement | HTMLSelectElement): number | null {
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  if (!Number.isInteger(n)) return null;
  if (n < WPM_MIN || n > WPM_MAX) return null;
  if (n % WPM_STEP !== 0) return null;
  return n;
}

function readFontSize(el: HTMLInputElement | HTMLSelectElement): number | null {
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  if (!Number.isInteger(n)) return null;
  if (n < FONT_SIZE_MIN || n > FONT_SIZE_MAX) return null;
  return n;
}

function readFont(el: HTMLInputElement | HTMLSelectElement): string | null {
  // #28 — the V4 schema is `font: z.string()`; the UI must not narrow
  // what storage accepts. `populate()` snaps display via `resolveFontId`,
  // which is the canonical read-side migration boundary. We only short-
  // circuit on the empty-string sentinel (HTML drift that wipes the
  // value to empty has nothing to persist).
  const v = el.value;
  if (v.trim() === '') return null;
  return v;
}

function readTheme(el: HTMLInputElement | HTMLSelectElement): SettingsV6['theme'] | null {
  const v = el.value as SettingsV6['theme'];
  return (THEME_VALUES as readonly string[]).includes(v) ? v : null;
}

function readAlignment(el: HTMLInputElement | HTMLSelectElement): SettingsV6['alignment'] | null {
  const v = el.value as SettingsV6['alignment'];
  return (ALIGNMENT_VALUES as readonly string[]).includes(v) ? v : null;
}

function readCheckbox(el: HTMLInputElement | HTMLSelectElement): boolean | null {
  return el instanceof HTMLInputElement ? el.checked : null;
}

function readChunkSize(el: HTMLInputElement | HTMLSelectElement): SettingsV6['chunkSize'] | null {
  // Select values are strings even when the underlying schema is a
  // numeric literal union; parse, then validate against the V6 literal
  // set so HTML drift (a "4" option added to the select) does not
  // sneak past the boundary into storage.
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  if (!Number.isInteger(n)) return null;
  if (!(CHUNK_SIZE_VALUES as readonly number[]).includes(n)) return null;
  return n as SettingsV6['chunkSize'];
}

const FIELD_READERS: { [K in EditableField]: Reader<K> } = {
  wpm: readWpm,
  theme: readTheme,
  font: readFont,
  fontSize: readFontSize,
  punctuationPacing: readCheckbox,
  alignment: readAlignment,
  contextLine: readCheckbox,
  startFromWordOne: readCheckbox,
  historyEnabled: readCheckbox,
  chunkSize: readChunkSize,
};

function bindField<K extends EditableField>(
  doc: Document,
  win: Window,
  field: K,
  el: HTMLInputElement | HTMLSelectElement,
  api: SettingsApi,
  isSavingAllowed: () => boolean,
): { el: Element; type: string; handler: EventListener } {
  const reader: Reader<K> = FIELD_READERS[field];
  const handler: EventListener = () => {
    if (!isSavingAllowed()) return;
    const value = reader(el);
    if (value === null) return;
    const patch = { [field]: value } as EditablePatch;
    // #28 — write only the field the user changed. The legacy
    // `openDyslexic` boolean is NOT mirrored on font-picker writes;
    // consumers must call `resolveFontId` (read-side migration in
    // `core/overlay/font-ids.ts`) rather than depending on a write-side
    // boolean mirror. The read path is the single source of truth.
    api.save(patch).then(
      () => flashIndicator(doc, win, SAVED_INDICATOR_ID, SAVED_INDICATOR_MS),
      (err) => {
        console.error('[speedreader] options: save failed', err);
        flashIndicator(doc, win, SAVE_ERROR_ID, SAVE_ERROR_MS);
      },
    );
  };
  el.addEventListener('change', handler);
  return { el, type: 'change', handler };
}

/**
 * Bind the options-page form to the settings API.
 *
 * Load → populate → wire change handlers → subscribe → wire flush triggers.
 *
 * On `api.load()` rejection the binder enters degraded mode: defaults are
 * shown for orientation, but change handlers suppress saves so a transient
 * sync error cannot overwrite the user's stored values with defaults. A
 * persistent banner (`#load-error-banner`) communicates the state.
 *
 * Returns a teardown function (unsubscribe + remove listeners) used by tests.
 */
export async function bindOptionsForm(
  doc: Document,
  win: Window,
  api: SettingsApi,
  onHistoryDisabled?: OnHistoryDisabled,
): Promise<() => void> {
  let degraded = false;
  let initial: SettingsV6;
  try {
    initial = await api.load();
  } catch (err) {
    degraded = true;
    initial = { ...DEFAULT_SETTINGS };
    console.error('[speedreader] options: load failed, entering degraded mode', err);
    showLoadErrorBanner(doc);
  }
  populate(doc, initial);

  // Surface HTML drift early: if any FIELD_IDS entry has no DOM element, the
  // corresponding setting becomes silently unreachable. Console error is the
  // best we can do without raising in user-facing code.
  const missing = (Object.keys(FIELD_IDS) as EditableField[]).filter(
    (f) => getInput(doc, FIELD_IDS[f]) === null,
  );
  if (missing.length > 0) {
    console.error('[speedreader] options: HTML missing field elements:', missing);
  }

  const listeners: Array<{ el: Element; type: string; handler: EventListener }> = [];
  const fields = Object.keys(FIELD_IDS) as EditableField[];
  const isSavingAllowed = (): boolean => !degraded;

  for (const field of fields) {
    const el = getInput(doc, FIELD_IDS[field]);
    if (!el) continue;
    listeners.push(bindField(doc, win, field, el, api, isSavingAllowed));
  }

  // #49 — fire the OnHistoryDisabled hook on a true→false transition of
  // the historyEnabled toggle. The hook reads the companion checkbox
  // (HISTORY_CLEAR_ON_DISABLE_ID) to decide whether to wipe entries too.
  // Tracked locally because settings subscribe re-fires on save and
  // would double-invoke the hook otherwise.
  let lastHistoryEnabled = initial.historyEnabled;
  const historyEl = getInput(doc, FIELD_IDS.historyEnabled);
  if (historyEl instanceof HTMLInputElement && onHistoryDisabled) {
    const historyHandler: EventListener = () => {
      const next = historyEl.checked;
      if (lastHistoryEnabled === true && next === false) {
        const clearBox = doc.getElementById(HISTORY_CLEAR_ON_DISABLE_ID);
        const alsoClear = clearBox instanceof HTMLInputElement && clearBox.checked;
        onHistoryDisabled(alsoClear);
      }
      lastHistoryEnabled = next;
    };
    historyEl.addEventListener('change', historyHandler);
    listeners.push({ el: historyEl, type: 'change', handler: historyHandler });
  }

  const unsubscribe = api.subscribe((s) => {
    populate(doc, s);
    lastHistoryEnabled = s.historyEnabled;
  });

  // Flush pending writes when the page is hidden so a close-before-debounce
  // does not drop the last change. `visibilitychange` covers tab-switch and
  // most close paths; `pagehide` is the more reliable last-gasp event for
  // navigations and full-window close that don't always fire visibilitychange.
  const flushIfHidden = (): void => {
    if (doc.visibilityState === 'hidden') {
      api.flush().catch((err) => {
        console.error('[speedreader] options: flush failed on visibility-hidden', err);
      });
    }
  };
  const flushOnPagehide = (): void => {
    api.flush().catch((err) => {
      console.error('[speedreader] options: flush failed on pagehide', err);
    });
  };
  doc.addEventListener('visibilitychange', flushIfHidden);
  win.addEventListener('pagehide', flushOnPagehide);

  return () => {
    listeners.forEach(({ el, type, handler }) => el.removeEventListener(type, handler));
    doc.removeEventListener('visibilitychange', flushIfHidden);
    win.removeEventListener('pagehide', flushOnPagehide);
    unsubscribe();
  };
}
