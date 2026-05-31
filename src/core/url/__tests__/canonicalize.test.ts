/**
 * Tests for `canonicalizeUrl` (#48).
 *
 * The canonicalization is the join key for persisted reading positions.
 * Two URLs that differ only in fragment, utm_* tracking params, or host
 * casing should collapse to the same key so a returning reader resumes
 * regardless of how they re-arrived at the page.
 */
import { describe, expect, test } from 'vitest';
import { canonicalizeUrl } from '../canonicalize';

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
      const twice = canonicalizeUrl(once);
      expect(twice).toBe(once);
    }
  });

  test('returns the input verbatim when URL parsing fails (defensive)', () => {
    // Malformed input — caller should never pass this, but the canonical
    // form must never throw because it is on the activation hot path.
    expect(canonicalizeUrl('not a url')).toBe('not a url');
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
