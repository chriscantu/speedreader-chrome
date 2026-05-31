import { describe, expect, test } from 'vitest';
import { renderWord } from '../word';
import { OVERLAY_CLASS } from '../constants';

describe('renderWord', () => {
  test('writes a .word-run wrapper with three child spans (before / focus / after)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'example');
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    expect(runs).toHaveLength(1);
    const spans = runs[0].querySelectorAll(':scope > span');
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe('ex');
    expect(spans[1].textContent).toBe('a');
    expect(spans[2].textContent).toBe('mple');
    expect(spans[1].classList.contains('focus')).toBe(true);
  });

  test('handles short words (orp returns 0)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'hi');
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    const spans = runs[0].querySelectorAll(':scope > span');
    expect(spans[0].textContent).toBe('');
    expect(spans[1].textContent).toBe('h');
    expect(spans[2].textContent).toBe('i');
  });

  test('replaces previous content on repeated calls', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'first');
    renderWord(region, 'second');
    expect(region.textContent).toBe('second');
  });

  test('empty word clears region textContent but keeps the .word-run wrapper', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'preset');
    renderWord(region, '');
    expect(region.textContent).toBe('');
    // Still emits a wrapper with three empty spans (degenerate empty-word
    // contract; the engine never emits empty words in practice).
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    expect(runs).toHaveLength(1);
    expect(runs[0].querySelectorAll(':scope > span')).toHaveLength(3);
  });
});
