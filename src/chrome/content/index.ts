/**
 * SpeedReader — Content Script
 *
 * This script is injected into page contexts by the manifest's content_scripts
 * entry.  It handles:
 * - Article extraction via Readability (issue #17)
 * - RSVP overlay rendering (issues #19, #20)
 * - Communication with the background service worker
 *
 * See manifest.ts for the content script entry point.
 */

// TODO(#5): Implement content script logic
// - Inject Readability-based article extraction
// - Render RSVP overlay with word-by-word display
// - Listen for messages from background/service worker
// - Handle play/pause, speed control, keyboard shortcuts

console.log('[SpeedReader] Content script loaded');
