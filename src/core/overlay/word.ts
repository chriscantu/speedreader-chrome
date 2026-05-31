import { splitWordAtFocus } from '../orp';
import { OVERLAY_CLASS } from './constants';

/**
 * Build a single .word-run element with three child spans (before /
 * focus / after) for `word`. The middle span carries the `focus` class
 * for ORP-highlight styling. Internal helper shared by `renderWord` and
 * `renderChunk` so both surfaces produce structurally identical per-word
 * markup that the `:host([data-alignment="orp"]) .word-run` grid styles
 * consume.
 */
function buildWordRun(doc: Document, word: string): HTMLElement {
  const { before, focus, after } = splitWordAtFocus(word);
  const run = doc.createElement('span');
  run.className = OVERLAY_CLASS.WORD_RUN;
  const beforeSpan = doc.createElement('span');
  beforeSpan.textContent = before;
  const focusSpan = doc.createElement('span');
  focusSpan.className = 'focus';
  focusSpan.textContent = focus;
  const afterSpan = doc.createElement('span');
  afterSpan.textContent = after;
  run.append(beforeSpan, focusSpan, afterSpan);
  return run;
}

/**
 * Render `word` into `region` as a single `.word-run` wrapper containing
 * three child spans (before / focus / after). The middle span carries
 * the `focus` class for ORP-highlight styling. Repeated calls replace
 * the prior content.
 *
 * The `.word-run` wrapper is the grid container that
 * `:host([data-alignment="orp"]) .word-run` styles consume — single-word
 * mode therefore shares the same alignment behaviour as chunk-mode
 * (each chunk word renders as its own `.word-run`).
 *
 * Pure DOM mutation — no chrome.*, safe for src/core. The caller provides the
 * region element; this module does not query the document.
 */
export function renderWord(region: Element, word: string): void {
  const doc = region.ownerDocument;
  region.replaceChildren(buildWordRun(doc, word));
}

/**
 * Render a multi-word chunk into `region` as N `.word-run` wrappers
 * (one per chunk word), separated by space text nodes. Each run carries
 * its own before/focus/after spans so the ORP focus character is
 * positioned per-word — `splitWordAtFocus` runs against the individual
 * word, NOT the joined chunk text (the pre-#52 path called
 * `renderWord(region, ev.text)` which produced a nonsensical focus
 * position somewhere inside the joined string).
 *
 * `chunkText` is accepted for symmetry with `renderWord(region, ev.text)`
 * and to make the function's contract self-evident at the call site;
 * the rendered text is built from `chunkWords` (the same source the
 * engine uses to join `ev.text`), so `region.textContent` is
 * `chunkWords.join(' ')` by construction.
 *
 * Empty `chunkWords` clears the region (degenerate guard; the engine
 * never emits an empty chunk in practice).
 */
export function renderChunk(region: Element, _chunkText: string, chunkWords: string[]): void {
  const doc = region.ownerDocument;
  if (chunkWords.length === 0) {
    region.replaceChildren();
    return;
  }
  const nodes: Node[] = [];
  for (let i = 0; i < chunkWords.length; i++) {
    if (i > 0) nodes.push(doc.createTextNode(' '));
    nodes.push(buildWordRun(doc, chunkWords[i]));
  }
  region.replaceChildren(...nodes);
}
