/**
 * Tests for `canonicalizeUrl` (#48).
 *
 * The canonicalization is the join key for persisted reading positions.
 * Two URLs that differ only in fragment, utm_* tracking params, or host
 * casing should collapse to the same key so a returning reader resumes
 * regardless of how they re-arrived at the page.
 *
 * Also asserts the scheme allow-list (http/https only) and the
 * `MAX_CANONICAL_URL_LENGTH` cap — both return `null` so the store
 * skips persistence on non-readable origins.
 */
import { describe, expect, test } from 'vitest';
import { MAX_CANONICAL_URL_LENGTH, canonicalizeUrl } from '../canonicalize';

describe('canonicalizeUrl', () => {
  test('strips the URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/article#section-2')).toBe(
      'https://example.com/article',
    );
  });

  test('strips a single utm_* query param while preserving other params', () => {
    expect(canonicalizeUrl('https://example.com/post?id=42&utm_source=twitter')).toBe(
      'https://example.com/post?id=42',
    );
  });

  test('strips multiple utm_* params (utm_source, utm_medium, utm_campaign, utm_term, utm_content)', () => {
    const input =
      'https://example.com/x?a=1&utm_source=fb&utm_medium=cpc&utm_campaign=spring&utm_term=foo&utm_content=bar&b=2';
    expect(canonicalizeUrl(input)).toBe('https://example.com/x?a=1&b=2');
  });

  test('strips arbitrary utm_-prefixed params (utm_xyz)', () => {
    expect(canonicalizeUrl('https://example.com/?utm_custom=abc&keep=yes')).toBe(
      'https://example.com/?keep=yes',
    );
  });

  test('lowercases the host while leaving the path case-sensitive', () => {
    expect(canonicalizeUrl('https://EXAMPLE.COM/CaseSensitive/Path')).toBe(
      'https://example.com/CaseSensitive/Path',
    );
  });

  test('preserves non-utm query params (id, q, page, etc.)', () => {
    expect(canonicalizeUrl('https://example.com/search?q=rsvp&page=3')).toBe(
      'https://example.com/search?q=rsvp&page=3',
    );
  });

  test('preserves params whose names contain but do not start with utm_', () => {
    // `not_utm_source` is NOT a tracking param — only utm_-prefixed names
    // should be dropped.
    expect(canonicalizeUrl('https://example.com/?not_utm_source=x&kutm_source=y')).toBe(
      'https://example.com/?not_utm_source=x&kutm_source=y',
    );
  });

  test('combines fragment strip + utm strip + host lowercase in a single pass', () => {
    const input = 'https://EXAMPLE.com/post?id=5&utm_source=fb#fragment';
    expect(canonicalizeUrl(input)).toBe('https://example.com/post?id=5');
  });

  test('is idempotent — canonicalize(canonicalize(u)) === canonicalize(u)', () => {
    const inputs = [
      'https://example.com/x?a=1&utm_source=fb#frag',
      'http://EXAMPLE.org/path',
      'https://example.com/page?q=test',
      'https://example.com/?utm_a=1&utm_b=2',
    ];
    for (const input of inputs) {
      const once = canonicalizeUrl(input);
      expect(once).not.toBeNull();
      const twice = canonicalizeUrl(once as string);
      expect(twice).toBe(once);
    }
  });

  test('returns null when URL parsing fails (defensive)', () => {
    // Malformed input — caller MUST skip persistence rather than write
    // a slot that cannot be matched against on revisit.
    expect(canonicalizeUrl('not a url')).toBeNull();
  });

  test('handles URLs with no path (only host) without inserting a stray slash beyond what URL produces', () => {
    // `new URL('https://example.com').toString()` adds a trailing slash;
    // we accept that as the canonical form (matches WHATWG URL spec).
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  test('preserves port and userinfo unchanged (out of scope for this canonicalization)', () => {
    expect(canonicalizeUrl('https://example.com:8080/path?utm_source=x')).toBe(
      'https://example.com:8080/path',
    );
  });
});

describe('canonicalizeUrl — scheme allow-list', () => {
  test.each([
    ['javascript:alert(1)'],
    ['data:text/plain;base64,SGVsbG8='],
    ['blob:https://example.com/abc-123'],
    ['chrome://settings/'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'],
    ['file:///Users/alice/notes.md'],
    ['about:blank'],
    ['ws://example.com:8080/'],
    ['wss://example.com/socket'],
    ['mailto:user@example.com'],
    ['tel:+15551234567'],
    ['ftp://example.com/pub/file'],
    ['view-source:https://example.com/'],
  ])('rejects %s with null', (input) => {
    expect(canonicalizeUrl(input)).toBeNull();
  });

  test('accepts http:', () => {
    expect(canonicalizeUrl('http://example.com/x')).toBe('http://example.com/x');
  });

  test('accepts https:', () => {
    expect(canonicalizeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
});

describe('canonicalizeUrl — length cap', () => {
  test('returns null when the canonical form exceeds MAX_CANONICAL_URL_LENGTH', () => {
    // Build a URL whose canonical form will exceed the cap. Use a long
    // path segment of `a` characters; canonicalization doesn't shorten
    // the path so we can predict the post-cap length precisely.
    const base = 'https://example.com/';
    const padding = 'a'.repeat(MAX_CANONICAL_URL_LENGTH); // base + padding > cap
    const input = base + padding;
    expect(canonicalizeUrl(input)).toBeNull();
  });

  test('accepts URLs at exactly MAX_CANONICAL_URL_LENGTH', () => {
    const base = 'https://example.com/';
    const padding = 'a'.repeat(MAX_CANONICAL_URL_LENGTH - base.length);
    const input = base + padding;
    const got = canonicalizeUrl(input);
    expect(got).not.toBeNull();
    expect(got?.length).toBe(MAX_CANONICAL_URL_LENGTH);
  });

  test('accepts URLs one byte below the cap (boundary)', () => {
    const base = 'https://example.com/';
    const padding = 'a'.repeat(MAX_CANONICAL_URL_LENGTH - base.length - 1);
    const input = base + padding;
    expect(canonicalizeUrl(input)?.length).toBe(MAX_CANONICAL_URL_LENGTH - 1);
  });
});
