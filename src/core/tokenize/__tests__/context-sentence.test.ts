import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenize';
import { markSentenceBoundaries } from '../sentence-boundary';
import { contextSentence } from '../context-sentence';

// Cases ported from the Safari reference
// (chriscantu/speed-reader/tests/js/state-machine.test.js — `contextSentence`
// describe block, non-chunk only; chunk-specific cases deferred to issue #51).
//
// Safari's state machine owns both the word array and the token stream; the
// Chrome engine only owns the word array (string[]), so the helper takes a
// `MarkedToken[]` plus the engine's current word index and returns the
// sentence words + highlight index. See PR for design-choice rationale.

describe('contextSentence — Safari parity (non-chunk)', () => {
  it('returns words in current sentence with highlight index (mid-2nd-sentence)', () => {
    // Safari: sm.init('First sentence. Second sentence.'); sm.chunkIndex = 3;
    //   → words: ['Second', 'sentence.'], highlightIndex: 1
    const marks = markSentenceBoundaries(tokenize('First sentence. Second sentence.'));
    const ctx = contextSentence(marks, 3);
    expect(ctx.words).toEqual(['Second', 'sentence.']);
    expect(ctx.highlightIndex).toBe(1);
  });

  it('returns first sentence when at start', () => {
    // Safari: sm.chunkIndex = 0; → words: ['First', 'sentence.'], highlightIndex: 0
    const marks = markSentenceBoundaries(tokenize('First sentence. Second sentence.'));
    const ctx = contextSentence(marks, 0);
    expect(ctx.words).toEqual(['First', 'sentence.']);
    expect(ctx.highlightIndex).toBe(0);
  });

  it('returns empty for index past end', () => {
    // Safari: sm.chunkIndex = sm.chunks.length;
    //   → words: [], highlightIndex: -1
    const marks = markSentenceBoundaries(tokenize('Hello world.'));
    const ctx = contextSentence(marks, 2); // 2 words; index 2 is past end
    expect(ctx.words).toEqual([]);
    expect(ctx.highlightIndex).toBe(-1);
  });
});

describe('contextSentence — Chrome additions', () => {
  it('returns empty for negative index', () => {
    const marks = markSentenceBoundaries(tokenize('Hello world.'));
    const ctx = contextSentence(marks, -1);
    expect(ctx.words).toEqual([]);
    expect(ctx.highlightIndex).toBe(-1);
  });

  it('returns empty for NaN index', () => {
    const marks = markSentenceBoundaries(tokenize('Hello world.'));
    const ctx = contextSentence(marks, Number.NaN);
    expect(ctx.words).toEqual([]);
    expect(ctx.highlightIndex).toBe(-1);
  });

  it('returns empty for empty input', () => {
    const marks = markSentenceBoundaries(tokenize(''));
    const ctx = contextSentence(marks, 0);
    expect(ctx.words).toEqual([]);
    expect(ctx.highlightIndex).toBe(-1);
  });

  it('handles single-word sentence', () => {
    const marks = markSentenceBoundaries(tokenize('Hi.'));
    const ctx = contextSentence(marks, 0);
    expect(ctx.words).toEqual(['Hi.']);
    expect(ctx.highlightIndex).toBe(0);
  });

  it('handles three sentences — highlights middle sentence correctly', () => {
    // Words: ['One', 'word.', 'Two', 'words', 'here.', 'Three', 'and', 'final.']
    // Word index 3 ("words") is in middle sentence ['Two', 'words', 'here.']
    const marks = markSentenceBoundaries(tokenize('One word. Two words here. Three and final.'));
    const ctx = contextSentence(marks, 3);
    expect(ctx.words).toEqual(['Two', 'words', 'here.']);
    expect(ctx.highlightIndex).toBe(1);
  });

  it('treats paragraph break as sentence boundary', () => {
    // Tokens: ['Para', 'one.', '\n\n', 'Para', 'two.']
    // Word index 3 ("two.") → second-paragraph sentence
    const marks = markSentenceBoundaries(tokenize('Para one.\n\nPara two.'));
    const ctx = contextSentence(marks, 3);
    expect(ctx.words).toEqual(['Para', 'two.']);
    expect(ctx.highlightIndex).toBe(1);
  });

  it('ignores dash tokens — only words count toward indexing', () => {
    // Input "Hello — world." tokenizes to ['Hello', '—', 'world.']
    // Word array (what engine sees) is ['Hello', 'world.'] — word index 1 is 'world.'
    const marks = markSentenceBoundaries(tokenize('Hello — world.'));
    const ctx = contextSentence(marks, 1);
    expect(ctx.words).toEqual(['Hello', 'world.']);
    expect(ctx.highlightIndex).toBe(1);
  });

  it('handles last sentence without terminal punctuation', () => {
    // Words: ['First.', 'No', 'period', 'here']
    // Word index 2 ("period") → second sentence ['No', 'period', 'here']
    const marks = markSentenceBoundaries(tokenize('First. No period here'));
    const ctx = contextSentence(marks, 2);
    expect(ctx.words).toEqual(['No', 'period', 'here']);
    expect(ctx.highlightIndex).toBe(1);
  });
});
