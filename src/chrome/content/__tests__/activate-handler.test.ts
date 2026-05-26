/**
 * Issue #134 — CS-side `activate-reader` recheck.
 *
 * The SW-side post-injection `isRestricted` recheck (PR #133) cannot
 * close the microtask window between the recheck and
 * `chrome.tabs.sendMessage`. A tab that navigates to a restricted
 * origin in that window would have the CS land `activate-reader`
 * against the new document. The CS has authoritative knowledge of its
 * own document origin and so MUST self-check before invoking the
 * overlay.
 *
 * This suite tests the pure handler in isolation. The listener wiring
 * in `content/index.ts` is the thin glue that calls into this function.
 */
import { describe, it, expect } from 'vitest';
import { handleActivateReader } from '../activate-handler';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('handleActivateReader — issue #134 CS-side recheck', () => {
  it('refuses with restricted-cs when location.href is a chrome:// URL', () => {
    const result = handleActivateReader('chrome://settings', OWN_ID);
    expect(result).toEqual({ ok: false, reason: 'restricted-cs' });
  });

  it('refuses with restricted-cs on the Chrome Web Store', () => {
    const result = handleActivateReader(
      'https://chromewebstore.google.com/category/extensions',
      OWN_ID,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('restricted-cs');
  });

  it('refuses with restricted-cs on a foreign chrome-extension URL', () => {
    const foreignId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const result = handleActivateReader(`chrome-extension://${foreignId}/popup.html`, OWN_ID);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('restricted-cs');
  });

  it('allows an allowed https URL', () => {
    const result = handleActivateReader('https://example.com/article', OWN_ID);
    expect(result).toEqual({ ok: true });
  });

  it('allows our own chrome-extension URL', () => {
    const result = handleActivateReader(`chrome-extension://${OWN_ID}/popup.html`, OWN_ID);
    expect(result).toEqual({ ok: true });
  });

  it('refuses on a malformed URL (defense-in-depth)', () => {
    const result = handleActivateReader('not a url', OWN_ID);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('restricted-cs');
  });
});
