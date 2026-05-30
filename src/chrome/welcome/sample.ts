/**
 * Canned sample passage for the Calibrate view's preview stream.
 *
 * Project-neutral, no proper nouns, no rare words. Word count is ~60 so
 * two passes at 250 wpm take roughly half a minute — long enough for the
 * user to feel the cadence, short enough that the WCAG 2.2.2 two-loop
 * cap doesn't strand them in motion they didn't ask for.
 *
 * The string is split into words at runtime by the welcome controller
 * before being handed to `createRsvpEngine`.
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md
 * §"View 2 — Calibrate".
 */
export const SAMPLE_PASSAGE =
  'Reading one word at a time can feel different at first. The trick is to relax your eyes and let each word land in the center of your view. As the words flow past, your brain stitches them together into sentences. You do not need to chase them. Start slow, then nudge the slider up when you are ready for more speed.';
