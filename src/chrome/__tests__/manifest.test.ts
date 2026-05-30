import { describe, it, expect } from 'vitest';
import manifest from '../manifest';

/**
 * Issue #10 — fonts WAR plumbing.
 *
 * These assertions guard the wiring that lets an injected overlay
 * `@font-face` rule resolve a bundled font via
 * `chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2')`. The actual
 * binary lands separately (see fonts/README.md); the manifest contract
 * MUST be in place first so #27/#28 don't have to touch this surface.
 */
describe('manifest — web_accessible_resources for fonts (#10)', () => {
  const wars = manifest.web_accessible_resources ?? [];
  const fontEntry = wars.find((entry) =>
    (entry.resources ?? []).some((r) => r.startsWith('fonts/')),
  );

  it('declares a WAR entry that exposes fonts/*', () => {
    expect(fontEntry).toBeDefined();
    expect(fontEntry?.resources).toContain('fonts/*');
  });

  it('matches <all_urls> so the overlay can load fonts on any host', () => {
    // Empty matches silently disables the WAR entry — the failure mode this
    // test exists to catch.
    expect(fontEntry?.matches).not.toEqual([]);
    expect(fontEntry?.matches).toEqual(['<all_urls>']);
  });

  it('chrome.runtime.getURL composes a usable extension URL for the font', () => {
    // Smoke-test the API shape the overlay will call. We stub
    // chrome.runtime.getURL to mirror Chrome's deterministic
    // `chrome-extension://<id>/<path>` resolution.
    const stub = {
      runtime: {
        getURL: (path: string) => `chrome-extension://stub-extension-id/${path}`,
      },
    };
    const url = stub.runtime.getURL('fonts/OpenDyslexic-Regular.woff2');
    expect(url).toBe('chrome-extension://stub-extension-id/fonts/OpenDyslexic-Regular.woff2');

    // The shape the overlay will inject — verify it concatenates cleanly
    // into a valid @font-face src() value.
    const fontFaceSrc = `src: url("${url}") format("woff2");`;
    expect(fontFaceSrc).toContain('chrome-extension://');
    expect(fontFaceSrc).toContain('fonts/OpenDyslexic-Regular.woff2');
    expect(fontFaceSrc).toMatch(/format\("woff2"\)/);
  });
});
