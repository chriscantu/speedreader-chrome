/**
 * chunk-mode.spec.ts — automates PR #201 manual smoke items 1-3.
 *
 * Mounts the overlay programmatically (same bundle pattern as overlay.spec.ts)
 * with chunkSize 1/2/3 over an article containing sentence boundaries, plays
 * through to completion capturing word-region text per emission, and asserts:
 *
 *  - chunkSize=1: every emission is a single word (no spaces in the rendered
 *    text)
 *  - chunkSize=2: emissions group into pairs that never cross a sentence end
 *  - chunkSize=3: emissions group into triples that close early at sentence
 *    boundaries
 *
 * Smoke item #4 (punctuation pacing × chunkSize=2 longer gap after sentence-
 * ending chunks) is covered by the engine unit tests in
 * `src/core/rsvp-engine/__tests__/chunk-mode.test.ts` under "punctuation
 * pacing (chunk last-word multiplier)" — exact ms deltas are mode-deterministic
 * there, where the timer is virtual; in-browser timing assertions would be
 * flaky without contributing additional signal.
 */
import { test, expect } from '@playwright/test';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

// Chosen to exercise BOTH cases at chunkSize=3:
//   - chunks of size 3 that don't span a sentence end (`The quick brown`)
//   - chunks shortened mid-stream by a sentence boundary
//     (`Hello there.` at start, `fox.` and `Stop.` mid-stream)
// At chunkSize=2 the same stream produces a sentence-bounded layout where
// every chunk is 1-2 tokens with sentence-end only at the chunk's last token.
const ARTICLE_WORDS = [
  'Hello',
  'there.',
  'The',
  'quick',
  'brown',
  'fox.',
  'Stop.',
  'Go',
  'now.',
];

type ChunkSize = 1 | 2 | 3;

interface MountResult {
  emissions: string[];
}

async function mountAndPlay(
  page: import('@playwright/test').Page,
  words: string[],
  chunkSize: ChunkSize,
): Promise<MountResult> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  return await page.evaluate(
    ({ w, cs }) => {
      type OverlayMod = {
        createOverlay: (o: Record<string, unknown>) => { mount(): void };
      };
      type RsvpMod = {
        createRsvpEngine: (o: Record<string, unknown>) => unknown;
      };
      const overlayMod = (
        window as unknown as { __speedreader_overlay__: OverlayMod }
      ).__speedreader_overlay__;
      const rsvpMod = (window as unknown as { __speedreader_rsvp__: RsvpMod })
        .__speedreader_rsvp__;
      const emissions: string[] = [];
      return new Promise<{ emissions: string[] }>((resolve) => {
        const overlay = overlayMod.createOverlay({
          doc: document,
          words: w,
          initialSettings: { theme: 'light', wpm: 1200, chunkSize: cs },
          subscribeSettings: () => () => undefined,
          engineFactory: rsvpMod.createRsvpEngine,
          onWordAdvance: () => {
            const host = document.querySelector('[data-speedreader-overlay]');
            const region = host?.shadowRoot?.querySelector('.word-region');
            if (region) emissions.push(region.textContent ?? '');
          },
          onDone: () => resolve({ emissions }),
        });
        overlay.mount();
        setTimeout(() => resolve({ emissions }), 8000);
      });
    },
    { w: words, cs: chunkSize },
  );
}

function sentenceEndIndices(words: string[]): Set<number> {
  const set = new Set<number>();
  words.forEach((w, i) => {
    if (/[.!?]$/.test(w)) set.add(i);
  });
  return set;
}

test.describe('Overlay chunk mode (#51)', () => {
  test('chunkSize=1 — single-word display per emission', async ({ page }) => {
    const { emissions } = await mountAndPlay(page, ARTICLE_WORDS, 1);
    expect(emissions.length).toBeGreaterThan(0);
    for (const e of emissions) {
      expect(e.includes(' ')).toBe(false);
    }
    expect(emissions).toEqual(ARTICLE_WORDS);
  });

  test('chunkSize=2 — pairs, never crossing sentence boundaries', async ({
    page,
  }) => {
    const { emissions } = await mountAndPlay(page, ARTICLE_WORDS, 2);
    expect(emissions.length).toBeGreaterThan(0);
    const enders = sentenceEndIndices(ARTICLE_WORDS);
    let cursor = 0;
    for (const chunk of emissions) {
      const tokens = chunk.split(' ');
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(tokens.length).toBeLessThanOrEqual(2);
      const startIdx = cursor;
      const endIdx = cursor + tokens.length - 1;
      // Every token in the chunk must match the source stream at its raw position.
      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i]).toBe(ARTICLE_WORDS[cursor + i]);
      }
      // Sentence-end MUST only appear at the LAST token of the chunk —
      // an interior sentence-end would mean the chunk crossed a boundary.
      for (let i = startIdx; i < endIdx; i++) {
        expect(enders.has(i)).toBe(false);
      }
      cursor += tokens.length;
    }
    expect(cursor).toBe(ARTICLE_WORDS.length);
  });

  test('chunkSize=3 — triples, sentence boundaries shorten chunks', async ({
    page,
  }) => {
    const { emissions } = await mountAndPlay(page, ARTICLE_WORDS, 3);
    expect(emissions.length).toBeGreaterThan(0);
    const enders = sentenceEndIndices(ARTICLE_WORDS);
    let cursor = 0;
    let sawShortChunkAtBoundary = false;
    for (const chunk of emissions) {
      const tokens = chunk.split(' ');
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(tokens.length).toBeLessThanOrEqual(3);
      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i]).toBe(ARTICLE_WORDS[cursor + i]);
      }
      const endIdx = cursor + tokens.length - 1;
      for (let i = cursor; i < endIdx; i++) {
        expect(enders.has(i)).toBe(false);
      }
      // A chunk shorter than 3 followed by more text must terminate at a
      // sentence-end (proving the close was sentence-driven, not EOF).
      if (tokens.length < 3 && endIdx < ARTICLE_WORDS.length - 1) {
        expect(enders.has(endIdx)).toBe(true);
        sawShortChunkAtBoundary = true;
      }
      cursor += tokens.length;
    }
    expect(cursor).toBe(ARTICLE_WORDS.length);
    expect(sawShortChunkAtBoundary).toBe(true);
  });
});
