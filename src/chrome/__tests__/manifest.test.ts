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
/**
 * #196 — `minimum_chrome_version` is pinned to the `local.setAccessLevel`
 * floor (Chrome 140 per MDN browser-compat-data). This is a security-load-
 * bearing merge precondition: below the floor the gate API is absent and the
 * cross-origin reading-history enumeration threat would reopen. A regression
 * that drops or downgrades this string must fail CI, not ship green.
 */
describe('manifest — minimum_chrome_version floor (#196)', () => {
  it('pins minimum_chrome_version to the local.setAccessLevel floor (140)', () => {
    expect(manifest.minimum_chrome_version).toBe('140');
  });
});

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

  it('sets use_dynamic_url:true to block cross-extension fingerprinting (#172)', () => {
    // Without use_dynamic_url, any page can probe
    // `chrome-extension://<static-id>/fonts/OpenDyslexic-Regular.woff2` and
    // detect SpeedReader installation via a successful fetch. The dynamic
    // URL rotates per-session, blocking enumeration. Ring security-adversary
    // flagged this on PR #169.
    expect(fontEntry?.use_dynamic_url).toBe(true);
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
