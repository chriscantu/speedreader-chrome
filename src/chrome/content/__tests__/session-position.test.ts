/**
 * Unit tests for the session-scoped resume helper (#25).
 *
 * The helper is the lowest-cost surface for verifying the resume
 * semantics — keeping the assertions on the pure module rather than
 * stitching them through the full content-script harness (which would
 * also have to stub `chrome.runtime`, the SW handshake, and async
 * settings load) keeps the regression coverage tight.
 */
import { afterEach, describe, expect, test } from 'vitest';
import type { OverlayCloseSnapshot } from '../../../core/overlay';
import { __resetSessionPositionsForTests, recordClose, resumeIndex } from '../session-position';

afterEach(() => {
  __resetSessionPositionsForTests();
});

describe('session-position — recordClose + resumeIndex round-trip', () => {
  test('records the close index under the active scope', () => {
    recordClose({ index: 42, total: 200, scope: 'full' });
    expect(resumeIndex('full', 200)).toBe(42);
  });

  test('selection and full scopes are tracked independently', () => {
    recordClose({ index: 5, total: 20, scope: 'selection' });
    recordClose({ index: 80, total: 500, scope: 'full' });
    expect(resumeIndex('selection', 20)).toBe(5);
    expect(resumeIndex('full', 500)).toBe(80);
  });

  test('the most recent record wins for a scope', () => {
    recordClose({ index: 10, total: 100, scope: 'full' });
    recordClose({ index: 75, total: 100, scope: 'full' });
    expect(resumeIndex('full', 100)).toBe(75);
  });
});

describe('session-position — guards against stale or unusable state', () => {
  test('returns undefined when nothing is recorded for the scope', () => {
    expect(resumeIndex('full', 100)).toBeUndefined();
    expect(resumeIndex('selection', 100)).toBeUndefined();
  });

  test('returns undefined when the recorded wordCount disagrees (page mutated)', () => {
    recordClose({ index: 30, total: 100, scope: 'full' });
    expect(resumeIndex('full', 101)).toBeUndefined();
    expect(resumeIndex('full', 99)).toBeUndefined();
  });

  test('returns undefined when stored index is zero (nothing to resume to)', () => {
    recordClose({ index: 0, total: 100, scope: 'full' });
    expect(resumeIndex('full', 100)).toBeUndefined();
  });

  test('returns undefined when stored index is past the end of the new stream', () => {
    recordClose({ index: 100, total: 100, scope: 'full' });
    expect(resumeIndex('full', 100)).toBeUndefined();
  });

  test('ignores undefined snapshot (mount aborted before engine creation)', () => {
    recordClose({ index: 12, total: 50, scope: 'full' });
    recordClose(undefined);
    // Prior record is preserved.
    expect(resumeIndex('full', 50)).toBe(12);
  });

  test('ignores snapshot with total === 0 (empty stream — no useful position)', () => {
    recordClose({ index: 8, total: 80, scope: 'full' });
    recordClose({ index: 0, total: 0, scope: 'full' });
    expect(resumeIndex('full', 80)).toBe(8);
  });

  test('snapshot scope mismatch does not cross streams', () => {
    recordClose({ index: 25, total: 100, scope: 'full' });
    const fakeSnapshot: OverlayCloseSnapshot = { index: 3, total: 10, scope: 'selection' };
    recordClose(fakeSnapshot);
    expect(resumeIndex('full', 100)).toBe(25);
    expect(resumeIndex('selection', 10)).toBe(3);
  });
});
