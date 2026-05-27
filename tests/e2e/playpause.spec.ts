/**
 * playpause.spec.ts — placeholder stub (#38 follow-up).
 *
 * The prior body invented an inline `setInterval` toy engine inside
 * `page.evaluate` and asserted on the toy — tautological self-assertion
 * with nothing to do with `src/core/rsvp-engine/`. PR #143 antagonistic
 * review (scope §1, test-gap §1) flagged this as a placebo.
 *
 * Root cause: `activeTab` is gesture-bound; Playwright cannot dispatch
 * the gesture-provenance signal Chromium requires, so an SW-driven
 * `chrome.scripting.executeScript` cannot be triggered from a spec.
 * The real fix needs a CDP activation bridge or a different harness
 * path — out of scope for this PR. See
 * `experiments/activeTab-commands-check/` for the empirical write-up.
 *
 * The authoritative engine already has unit coverage in
 * `src/core/rsvp-engine/rsvp-engine.test.ts`. Restore real assertions
 * when overlay (#19) and extraction (#20) land and a gesture-surrogate
 * is available, at which point this spec should drive a DOM-driven
 * assertion against the overlay's ORP word.
 */
import { test } from '@playwright/test';

test('word advances on play, freezes on pause (#38)', () => {
  test.skip(
    true,
    'Blocked: activeTab gesture-bound (#38 follow-up); behavioral assertions require CDP activation bridge. See #19/#20 for overlay+extraction landing.',
  );
});
