/**
 * Tests for `deriveTitleFromUrl` (issue #49 — popup "Recently read"
 * display labels).
 *
 * The reading-position store (#48) does NOT persist article titles —
 * persisting them would require a schema bump (deferred to #196 spec).
 * Until then, the popup derives a display label from the URL: hostname
 * (no www.) plus the last meaningful path segment.
 *
 * Anti-tautology stance: assertions pin the OUTPUT STRING, not "URL
 * was parsed". A canonical-URL output of `example.com / about` for
 * `https://www.example.com/about` is the contract; a future change
 * that drops the path entirely would surface here.
 */
import { describe, it, expect } from 'vitest';
import { deriveTitleFromUrl } from '../derive-title';

describe('deriveTitleFromUrl — bare hostname', () => {
  it('returns hostname for root URL', () => {
    expect(deriveTitleFromUrl('https://example.com/')).toBe('example.com');
  });

  it('returns hostname for hostname without trailing slash', () => {
    expect(deriveTitleFromUrl('https://example.com')).toBe('example.com');
  });

  it('strips leading www. prefix', () => {
    expect(deriveTitleFromUrl('https://www.example.com/')).toBe('example.com');
  });

  it('does NOT strip non-www subdomains (en.wikipedia.org stays intact)', () => {
    expect(deriveTitleFromUrl('https://en.wikipedia.org/')).toBe('en.wikipedia.org');
  });
});

describe('deriveTitleFromUrl — hostname + path', () => {
  it('returns hostname / last-segment for single-segment path', () => {
    expect(deriveTitleFromUrl('https://example.com/about')).toBe('example.com / about');
  });

  it('returns hostname / last-segment for deep path', () => {
    expect(deriveTitleFromUrl('https://www.example.com/blog/2026/article-title')).toBe(
      'example.com / article-title',
    );
  });

  it('decodes percent-encoded path segments (URL-safe → human readable)', () => {
    expect(deriveTitleFromUrl('https://example.com/articles/hello%20world')).toBe(
      'example.com / hello world',
    );
  });

  it('handles trailing slash by using the last non-empty segment', () => {
    expect(deriveTitleFromUrl('https://example.com/blog/article/')).toBe('example.com / article');
  });

  it('truncates very long path segments to keep popup labels readable', () => {
    const longSegment = 'a'.repeat(120);
    const result = deriveTitleFromUrl(`https://example.com/${longSegment}`);
    // Truncated form: hostname / first-N-chars + ellipsis. Pin the
    // length cap so a future arbitrary widening surfaces here.
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toMatch(/example\.com \/ a+…$/);
  });
});

describe('deriveTitleFromUrl — query / fragment stripping', () => {
  it('strips query string (utm tags etc.) from the label', () => {
    expect(deriveTitleFromUrl('https://example.com/article?utm_source=feed&ref=twitter')).toBe(
      'example.com / article',
    );
  });

  it('strips fragment from the label', () => {
    expect(deriveTitleFromUrl('https://example.com/article#section-3')).toBe(
      'example.com / article',
    );
  });

  it('strips both query and fragment', () => {
    expect(deriveTitleFromUrl('https://example.com/a/b?x=1#top')).toBe('example.com / b');
  });
});

describe('deriveTitleFromUrl — defensive', () => {
  it('returns the raw input string when URL fails to parse', () => {
    // Non-URL strings shouldn't crash the popup; surface what the
    // store happens to hold rather than disappearing the row.
    expect(deriveTitleFromUrl('not a url')).toBe('not a url');
  });

  it('lowercases the host (parity with canonicalizeUrl)', () => {
    expect(deriveTitleFromUrl('https://EXAMPLE.com/Page')).toBe('example.com / Page');
  });

  it('handles file:// scheme by emitting the empty-host + last-segment shape', () => {
    // The reading-position store rejects file:// URLs (#48 canonicalization),
    // so this is a defensive path — a hand-crafted entry or a future
    // permitted-scheme change shouldn't crash the popup row.
    //
    // Contract pinned VERBATIM (anti-tautology): `new URL('file:///etc/hosts')`
    // exposes `hostname === ''` and `pathname === '/etc/hosts'`. The
    // current implementation runs the empty hostname through stripWww
    // (no-op) and concatenates with " / " + last segment, yielding
    // " / hosts". The leading space is a cosmetic artifact of an empty
    // host — acceptable because non-http schemes are not part of the
    // happy path, but pinning the exact string here surfaces any silent
    // contract drift (e.g., a future change to return the raw input,
    // hide the row, or throw).
    expect(deriveTitleFromUrl('file:///etc/hosts')).toBe(' / hosts');
  });
});
