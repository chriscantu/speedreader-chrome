/**
 * Pure rendering for the popup "Recently read" surface (issue #49).
 *
 * Adapter pattern: this module takes data + callbacks and returns a DOM
 * subtree. It does NOT touch `chrome.*`, the settings store, or the
 * reading-position store. The chrome glue in
 * `src/chrome/popup/index.ts` wires the callbacks:
 *   - onResume → `chrome.tabs.create({ url })`
 *   - onDelete → `ReadingPositionStore.clear(url)`
 *   - onClearAll → `ReadingPositionStore.clearAll()`
 *   - onEnableInSettings → `chrome.runtime.openOptionsPage()`
 *
 * Visibility model:
 *   - `enabled: false` → render an "off" message with an Enable link
 *     (NO list element rendered)
 *   - `enabled: true, entries: []` → render an empty-state message
 *     (NO list element rendered — pin via the empty-state test)
 *   - `enabled: true, entries: [...]` → render the list, capped at
 *     `MAX_DISPLAY_ENTRIES`
 *
 * Cap rationale (50): the underlying LRU is 100 entries (#48), but a
 * popup viewport tops out around 600 px on a comfortable display. 50
 * rows fits without scrolling churn and keeps the popup snappy.
 * "Show all" pagination beyond 50 is explicitly deferred (out of scope
 * for #49 per the brief).
 *
 * Pure — no `chrome.*`, no DOM imports from chrome modules. Uses the
 * global `document` and `window` so the section can be rendered into
 * any host page (popup, options page, future surfaces).
 */

import { deriveTitleFromUrl } from './derive-title';
import { formatRelativeTime } from './format-relative-time';

export const MAX_DISPLAY_ENTRIES = 50;

export interface HistorySectionEntry {
  /** Canonical URL from `ReadingPositionStore.list()`. */
  readonly url: string;
  /** `ReadingPosition.lastReadAt` in ms epoch. */
  readonly timestamp: number;
}

export interface HistorySectionProps {
  readonly entries: readonly HistorySectionEntry[];
  readonly enabled: boolean;
  readonly now: number;
  readonly onResume: (url: string) => void;
  readonly onDelete: (url: string) => void;
  readonly onClearAll: () => void;
  readonly onEnableInSettings: () => void;
}

export function renderHistorySection(props: HistorySectionProps): HTMLElement {
  const section = document.createElement('section');
  section.className = 'history';
  section.setAttribute('aria-labelledby', 'history-heading');

  const heading = document.createElement('h2');
  heading.id = 'history-heading';
  heading.className = 'history__heading';
  heading.textContent = 'Recently read';
  section.appendChild(heading);

  if (!props.enabled) {
    section.appendChild(renderDisabledState(props.onEnableInSettings));
    return section;
  }

  if (props.entries.length === 0) {
    section.appendChild(renderEmptyState());
    return section;
  }

  const visible = props.entries.slice(0, MAX_DISPLAY_ENTRIES);
  section.appendChild(renderList(visible, props));
  section.appendChild(renderClearAllButton(props.onClearAll));
  return section;
}

function renderDisabledState(onEnable: () => void): HTMLElement {
  const wrapper = document.createElement('p');
  wrapper.className = 'history__off';
  // Use a button rather than an anchor — anchors with no real href
  // either need href="#" (page-jump side effect) or JS-only handlers,
  // and a button is the accessibility-correct primitive for a
  // "navigate inside the extension" action.
  wrapper.append('Reading history is off. ');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'history__enable-link';
  btn.textContent = 'Enable in settings';
  btn.addEventListener('click', () => onEnable());
  wrapper.appendChild(btn);
  return wrapper;
}

function renderEmptyState(): HTMLElement {
  const p = document.createElement('p');
  p.className = 'history__empty';
  p.textContent = 'No articles yet. Open SpeedReader on an article to start tracking.';
  return p;
}

function renderList(
  entries: readonly HistorySectionEntry[],
  props: HistorySectionProps,
): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'history__list';
  // jsdom + axe both honor the role override; an <ul> already has
  // role=list, but the explicit attribute makes the test query stable
  // against a future tag swap (e.g., <ol>).
  ul.setAttribute('role', 'list');

  for (const entry of entries) {
    ul.appendChild(renderItem(entry, props));
  }
  return ul;
}

function renderItem(entry: HistorySectionEntry, props: HistorySectionProps): HTMLElement {
  const li = document.createElement('li');
  li.className = 'history__item';
  li.setAttribute('role', 'listitem');

  const title = deriveTitleFromUrl(entry.url);
  const time = formatRelativeTime(entry.timestamp, props.now);

  const resumeBtn = document.createElement('button');
  resumeBtn.type = 'button';
  resumeBtn.className = 'history__resume';
  resumeBtn.dataset.action = 'resume';
  // Accessible name comes from the text content; we wrap the time in a
  // span so it's visually distinguishable but still part of the name.
  resumeBtn.appendChild(document.createTextNode(title));
  const timeEl = document.createElement('span');
  timeEl.className = 'history__time';
  timeEl.textContent = time;
  resumeBtn.appendChild(timeEl);
  resumeBtn.addEventListener('click', () => props.onResume(entry.url));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'history__delete';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.setAttribute('aria-label', `Remove ${title} from reading history`);
  // U+00D7 multiplication sign — visually a × close glyph, kept out of
  // the accessible name (aria-label above provides the meaningful text).
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => props.onDelete(entry.url));

  li.appendChild(resumeBtn);
  li.appendChild(deleteBtn);
  return li;
}

function renderClearAllButton(onClearAll: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'history__clear-all';
  btn.dataset.action = 'clear-all';
  btn.textContent = 'Clear all';
  btn.addEventListener('click', () => {
    // Confirm dialog keeps the affordance reversible — clearing 50
    // entries on a misclick is a real annoyance, and the popup has
    // no undo. window.confirm() is the smallest reversible primitive
    // available in the popup context; a fancier in-popup confirm
    // dialog could replace this later without breaking callers.
    if (window.confirm('Clear all reading history?')) {
      onClearAll();
    }
  });
  return btn;
}
