# SpeedReader for Chrome

**Reading shouldn't be this hard.**

For millions of neurodivergent readers — people with ADHD, dyslexia, or other processing differences — traditional reading is exhausting. Eyes jump between lines, focus drifts mid-paragraph, and articles get abandoned halfway through.

RSVP (Rapid Serial Visual Presentation) changes that. By showing one word at a time at a controlled pace, it removes the cognitive overhead of eye tracking and line scanning. Your brain just... processes.

**SpeedReader for Chrome is a free, open-source Chrome extension that brings RSVP reading to every web page.** Fully responsive — works across desktop, tablet, and mobile viewports.

*This is the Chrome port of [chriscantu/speed-reader](https://github.com/chriscantu/speed-reader) (Safari).*

## Status

🚧 **In development.** First release targets the Chrome Web Store via the [M1 milestone](https://github.com/chriscantu/speedreader-chrome/milestone/1).

## Features (planned for M1)

- Focus-point (ORP) highlighting for each word
- Context preview when you pause
- Punctuation pacing (natural micro-pauses)
- Adjustable speed (100–600 WPM)
- OpenDyslexic font toggle and font picker
- Light, dark, and system theme
- Keyboard shortcuts (Space / arrows / Esc)
- Text-selection fallback when auto-extract fails
- Fully responsive — phone, tablet, desktop
- Runs entirely locally — no tracking, no data leaves your device

## Install (development)

Once tooling lands in [issue #1](https://github.com/chriscantu/speedreader-chrome/issues/1):

```bash
git clone https://github.com/chriscantu/speedreader-chrome.git
cd speedreader-chrome
npm install
npm run build
```

Then load the `dist/` directory as an unpacked extension at `chrome://extensions` (Developer Mode on).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Why this exists

The Safari version of SpeedReader was born out of personal need — as someone with ADHD and suspected dyslexia, traditional reading is genuinely tiring, and RSVP works for my brain in a way paragraphs of text don't. Chrome users deserve the same free, unlocked accessibility bridge.
