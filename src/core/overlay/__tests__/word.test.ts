import { describe, expect, test } from 'vitest';
import { renderWord } from '../word';

describe('renderWord', () => {
  test('writes three spans (before / focus / after) into the target element', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'example');
    const spans = region.querySelectorAll('span');
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
    const spans = region.querySelectorAll('span');
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

  test('empty word clears region', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderWord(region, 'preset');
    renderWord(region, '');
    expect(region.textContent).toBe('');
    expect(region.querySelectorAll('span')).toHaveLength(3);
  });
});
