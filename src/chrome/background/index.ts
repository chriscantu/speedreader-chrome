/**
 * SpeedReader — Background Service Worker (Manifest V3)
 *
 * This file serves as the extension's service worker.  It handles:
 * - Messaging between content scripts, popup, and options page
 * - Persistent state management via chrome.storage
 * - Keyboard shortcut activation (issue #34)
 *
 * See manifest.ts for the service_worker entry point.
 */

// TODO(#4): Implement service worker logic
// - Listen for messages from content scripts
// - Manage reading state (current article, position, speed)
// - Handle shortcut activation

console.log('[SpeedReader] Background service worker loaded');