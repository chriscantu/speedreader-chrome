/**
 * SpeedReader — Popup Script
 *
 * Entry point for the browser-action popup.  Handles popup UI state and
 * messaging with the content script / background service worker.
 */

// TODO(#5): Implement popup logic
// - Display current reading status
// - Show WPM, speed controls
// - Message content script to toggle reader

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = 'Ready';
  }
});
