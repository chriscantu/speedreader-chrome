/**
 * extraction.spec.ts — placeholder stub (#38 follow-up).
 *
 * The prior body bundle-grepped the built CS chunk for the string
 * `activate-reader` and asserted the fixture page rendered. Neither
 * exercised the extraction pipeline; both passed even if the activation
 * handler body were deleted. PR #143 antagonistic review (test-gap §1)
 * flagged this as a placebo and the spec is skipped pending the real
 * harness path.
 *
 * Root cause: `activeTab` is gesture-bound; Playwright cannot dispatch
 * the gesture-provenance signal Chromium requires, so an SW-driven
 * `chrome.scripting.executeScript` cannot be triggered from a spec.
 * The real fix needs a CDP activation bridge or a different harness
 * path — out of scope for this PR. See
 * `experiments/activeTab-commands-check/` for the empirical write-up.
 *
 * Restore real assertions when extraction (#20) lands and a
 * gesture-surrogate (e.g. test-only externally-connectable bridge) is
 * available.
 */
import { test } from '@playwright/test';

test('extraction runs on a fixture page (#38)', () => {
  test.skip(
    true,
    'Blocked: activeTab gesture-bound (#38 follow-up); behavioral assertions require CDP activation bridge. See #19/#20 for overlay+extraction landing.',
  );
});
