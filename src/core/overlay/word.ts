import { splitWordAtFocus } from '../orp';

/**
 * Render `word` into `region` as three <span> elements (before / focus / after).
 * The middle span carries the `focus` class for ORP-highlight styling. Repeated
 * calls replace the prior content.
 *
 * Pure DOM mutation — no chrome.*, safe for src/core. The caller provides the
 * region element; this module does not query the document.
 */
export function renderWord(region: Element, word: string): void {
  const { before, focus, after } = splitWordAtFocus(word);
  const doc = region.ownerDocument;
  const beforeSpan = doc.createElement('span');
  beforeSpan.textContent = before;
  const focusSpan = doc.createElement('span');
  focusSpan.className = 'focus';
  focusSpan.textContent = focus;
  const afterSpan = doc.createElement('span');
  afterSpan.textContent = after;
  region.replaceChildren(beforeSpan, focusSpan, afterSpan);
}
