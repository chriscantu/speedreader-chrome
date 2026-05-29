# Privacy Policy

**SpeedReader for Chrome**
Effective date: 2026-05-29

SpeedReader is a free, open-source Chrome extension that delivers Rapid
Serial Visual Presentation (RSVP) reading for any web page you choose to
read with it. It is built for neurodivergent readers (ADHD, dyslexia,
processing differences) and adjacent audiences who benefit from
distraction-free focused reading.

This document describes — in plain terms and with no marketing language —
what data the extension touches, where that data lives, and what it never
does.

## What we collect

**Nothing.**

SpeedReader does not collect, transmit, sell, share, or otherwise transfer
any personal information, browsing activity, page content, or analytics.

There are no accounts. There is no login. There is no server.

## What stays on your device

The following data is stored locally on your device via the standard
Chrome [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
API and never leaves it:

- **User preferences** — words per minute (WPM), font face, font size,
  theme (light / dark / system), and other settings exposed in the
  options page.
- **Reading session state** — the current word position when you pause
  or close the reader. This is held in memory or in `chrome.storage`
  for your convenience and is not transmitted anywhere.

You can clear this data at any time from `chrome://extensions/` →
SpeedReader → "Site settings" / "Remove extension".

## What we never do

- **No analytics.** No first-party or third-party analytics SDKs are
  bundled or loaded.
- **No telemetry.** No usage pings, no crash reports, no "anonymous"
  metrics.
- **No network calls.** The extension makes no outbound HTTP, WebSocket,
  `fetch`, `XMLHttpRequest`, or `sendBeacon` calls. The only network
  activity tied to the extension is Chrome's own update check for new
  versions, which is controlled by your browser, not by us.
- **No page content transmission.** When you trigger SpeedReader on a
  page, the extension reads the page's text locally in the content
  script and feeds it into the on-device RSVP engine. That text is
  never sent off the device.
- **No tracking across sites.** SpeedReader has no concept of "the same
  user across sites". The extension does not know what other pages you
  visit.
- **No sale, sharing, or transfer of data** under any meaning of those
  terms in GDPR, CCPA, or analogous regimes — because there is no data
  to sell, share, or transfer.

## Permissions, in plain language

Each Chrome permission the extension requests is requested because it is
required for the reading experience. None grant any kind of remote
access. Per-permission justifications live in
[`docs/permission-justifications.md`](docs/permission-justifications.md);
the short form:

- **`storage`** — persist your settings (WPM, font, theme) locally.
- **`activeTab`** — read the text of the tab you actively invoke the
  extension on, for the duration of that user gesture. Replaces broad
  `<all_urls>` host permissions.
- **`scripting`** — inject the content script into the active tab on
  demand when you open the popup or press the keyboard shortcut.
- **`contextMenus`** — register the right-click "SpeedReader" entry on
  text selections.

## Children's privacy

SpeedReader does not knowingly collect any information from children
under 13, because it does not collect information from anyone.

## Open source

The full source code is published at
<https://github.com/chriscantu/speedreader-chrome>. Anyone may inspect,
audit, build, or fork it. If the source code's behavior ever diverges
from the claims in this document, the source is the truth — please open
an issue.

## Changes to this policy

If a future release ever needs to change any of the claims above (for
example, an opt-in feature that touches a network), this document will
be updated in the same commit as the change, and the entry will be
called out in [`CHANGELOG.md`](CHANGELOG.md).

## Contact

Questions, concerns, or corrections: open an issue at
<https://github.com/chriscantu/speedreader-chrome/issues>.
