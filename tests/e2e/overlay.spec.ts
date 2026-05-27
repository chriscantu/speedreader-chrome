/**
 * overlay.spec.ts — placeholder stub (#38 follow-up).
 *
 * The prior body asserted the built CS bundle did NOT contain the
 * string `speedreader-overlay` — a negative-presence check on a feature
 * that doesn't exist yet, which passes against any CS that doesn't ship
 * the overlay. PR #143 antagonistic review (scope §1, test-gap §1)
 * flagged this as a placebo dressed as a test.
 *
 * Root cause: `activeTab` is gesture-bound; Playwright cannot dispatch
 * the gesture-provenance signal Chromium requires, so an SW-driven
 * `chrome.scripting.executeScript` cannot be triggered from a spec.
 * The real fix needs a CDP activation bridge or a different harness
 * path — out of scope for this PR. See
 * `experiments/activeTab-commands-check/` for the empirical write-up.
 *
 * Restore real assertions when overlay (#19) lands and a
 * gesture-surrogate is available.
 */
import { test } from '@playwright/test';

test('overlay element + ORP word appears (#38)', () => {
  test.skip(
    true,
    'Blocked: activeTab gesture-bound (#38 follow-up); behavioral assertions require CDP activation bridge. See #19/#20 for overlay+extraction landing.',
  );
});
