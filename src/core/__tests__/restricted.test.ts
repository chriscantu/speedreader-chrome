import { describe, it, expect } from 'vitest';
import { isRestricted } from '../restricted';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('isRestricted', () => {
  describe('restricted schemes', () => {
    const restrictedSchemeFixtures: ReadonlyArray<readonly [string, string]> = [
      ['chrome://settings', 'chrome:'],
      ['chrome-untrusted://terminal', 'chrome-untrusted:'],
      ['chrome-search://local-ntp', 'chrome-search:'],
      ['devtools://devtools/bundled/devtools_app.html', 'devtools:'],
      ['view-source:https://example.com', 'view-source:'],
      ['about:blank', 'about:'],
      ['about:config', 'about:'],
      ['data:text/html,<p>x</p>', 'data:'],
      ['javascript:void(0)', 'javascript:'],
      ['file:///tmp/x.html', 'file:'],
      ['blob:https://example.com/abc', 'blob:'],
      ['edge://settings', 'edge:'],
    ];

    for (const [url, scheme] of restrictedSchemeFixtures) {
      it(`rejects ${scheme} (${url})`, () => {
        expect(isRestricted(url, OWN_ID)).toBe(true);
      });
    }
  });

  describe('novel schemes (allow-list default-deny)', () => {
    // These schemes either don't ship in stable Chromium yet, are
    // proposed, or are obscure. An allow-list approach rejects them
    // all by default — a deny-list approach would silently allow them
    // until each is enumerated. Drives the design choice in #122.
    const novelSchemeFixtures: ReadonlyArray<readonly [string, string]> = [
      ['isolated-app://aaaaaaaaaaaaaaaa/index.html', 'isolated-app:'],
      ['chrome-distiller://abc123', 'chrome-distiller:'],
      ['filesystem:https://example.com/temporary/foo.txt', 'filesystem:'],
      ['ws://example.com/socket', 'ws:'],
      ['wss://example.com/socket', 'wss:'],
      ['ftp://example.com/file', 'ftp:'],
    ];

    for (const [url, scheme] of novelSchemeFixtures) {
      it(`rejects ${scheme} (${url}) under allow-list default-deny`, () => {
        expect(isRestricted(url, OWN_ID)).toBe(true);
      });
    }
  });

  describe('chrome-extension scheme', () => {
    it('rejects chrome-extension URLs from other extension IDs', () => {
      expect(isRestricted('chrome-extension://other-extension-id/popup.html', OWN_ID)).toBe(true);
    });

    it('allows chrome-extension URLs from our own extension ID', () => {
      expect(isRestricted(`chrome-extension://${OWN_ID}/popup.html`, OWN_ID)).toBe(false);
    });

    it('rejects all chrome-extension URLs when own ID is not provided', () => {
      expect(isRestricted(`chrome-extension://${OWN_ID}/popup.html`)).toBe(true);
      expect(isRestricted('chrome-extension://other/popup.html')).toBe(true);
    });
  });

  describe('Chrome Web Store hosts', () => {
    it('rejects chromewebstore.google.com', () => {
      expect(isRestricted('https://chromewebstore.google.com/', OWN_ID)).toBe(true);
      expect(isRestricted('https://chromewebstore.google.com/category/extensions', OWN_ID)).toBe(
        true,
      );
    });

    it('rejects chrome.google.com/webstore (legacy host path)', () => {
      expect(isRestricted('https://chrome.google.com/webstore', OWN_ID)).toBe(true);
      expect(isRestricted('https://chrome.google.com/webstore/category/extensions', OWN_ID)).toBe(
        true,
      );
    });

    it('does NOT reject chrome.google.com on non-webstore paths', () => {
      // Only the /webstore path on chrome.google.com is restricted; the host
      // itself serves other (non-restricted) Google content historically.
      expect(isRestricted('https://chrome.google.com/', OWN_ID)).toBe(false);
      expect(isRestricted('https://chrome.google.com/intl/en/index.html', OWN_ID)).toBe(false);
    });
  });

  describe('allowed URLs', () => {
    const allowed = [
      'https://example.com',
      'https://example.com/path?q=1#frag',
      'https://en.wikipedia.org/wiki/RSVP',
      'http://localhost:3000/',
    ];

    for (const url of allowed) {
      it(`allows ${url}`, () => {
        expect(isRestricted(url, OWN_ID)).toBe(false);
      });
    }
  });

  describe('malformed input', () => {
    it('rejects an empty string', () => {
      expect(isRestricted('', OWN_ID)).toBe(true);
    });

    it('rejects unparseable URLs', () => {
      expect(isRestricted('not a url', OWN_ID)).toBe(true);
    });
  });
});
