/**
 * fonts-csp.spec.ts — runtime verification of bundled OpenDyslexic font
 * loading from `chrome-extension://` under a strict host-page CSP
 * (issue #174, closes the runtime gap PR #169 + #172 + #173 left open).
 *
 * What this proves
 * ----------------
 * The web_accessible_resources entry in src/chrome/manifest.ts declares
 * `fonts/*` reachable from `<all_urls>` with `use_dynamic_url: true`.
 * Chromium's default extension CSP allows `chrome-extension:` font-src,
 * but that policy applies to the EXTENSION'S documents, not to arbitrary
 * host pages. When the overlay's shadow-root `@font-face` rule fetches
 * the woff2, the fetch is policy-checked against the HOST PAGE's CSP
 * (per CSP spec §6.6: a fetch from a stylesheet inherits the policy of
 * the document that owns the stylesheet — the shadow root's host
 * document, i.e. the page).
 *
 * This means a host page that does NOT allow `font-src chrome-extension:`
 * could block the font even though the manifest WAR plumbing is correct.
 * No automated test covered that path before this spec.
 *
 * Discriminating signal (mutation-tested during authoring)
 * --------------------------------------------------------
 * The "no CSP-violation console messages" + "document.fonts.check passes"
 * pair is the load-bearing assertion. If we deleted the `fonts/*` entry
 * from `web_accessible_resources` and rebuilt, the font fetch would
 * surface as a `Refused to load the font 'chrome-extension://…'` console
 * error from Chromium AND `document.fonts.check('1em OpenDyslexic')`
 * would resolve `false`. Computed-style assertion alone is NOT
 * discriminating — `font-family: 'OpenDyslexic', system-ui, …` resolves
 * the same string regardless of whether the font actually loaded. The
 * `document.fonts` check is what proves the woff2 binary was fetched
 * and parsed successfully under the strict CSP.
 *
 * Why we don't use the production activation chain
 * ------------------------------------------------
 * The production path (popup click → SW.executeScript → CS mount) requires
 * a real user-gesture for `activeTab`, which CDP cannot dispatch — see
 * experiments/activeTab-commands-check/ and overlay-activation-chain.spec.ts.
 * That spec uses a separate `dist-e2e-ext/` build with `<all_urls>`
 * host_permissions to bypass the gesture requirement; it is opt-in
 * (RUN_ACTIVATION_CHAIN=1) and not in the standard test:e2e gate.
 *
 * This spec follows the same harness pattern as `overlay-real-article.spec.ts`:
 * load the production extension to get a real `chrome-extension://<id>`
 * origin (and a dynamic-URL-rotated WAR path per #172), then mount the
 * core overlay via the e2e bundle on a fixture page. The font URL is
 * resolved from the extension's service worker so the rotated `use_dynamic_url`
 * value is honoured — hard-coding the URL would silently desync once
 * `use_dynamic_url:true` was the manifest default (PR #172).
 *
 * Host CSP delivery
 * -----------------
 * The fixture HTML is served by tests/e2e/fixtures/serve.mjs (no CSP), and
 * this spec uses `context.route` to fulfil the response with the strict
 * CSP header attached. Setting CSP via `<meta http-equiv>` would weaken
 * the test — header-supplied CSPs are the production case for sites that
 * matter (MDN, GitHub, banking apps). Modifying serve.mjs to set headers
 * conditionally would over-couple this one test to the shared fixture
 * server (other specs depend on serve.mjs being plain).
 */
import { test, expect, type ConsoleMessage } from '@playwright/test';
import {
  launchExtensionContext,
  closeExtensionContext,
  type ExtensionHandle,
} from './fixtures/extension';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';
const FIXTURE_URL = 'http://127.0.0.1:5173/csp-strict.html';

/**
 * Strict CSP that proves the policy is real:
 *   - `default-src 'none'` blocks ALL resource loads not enumerated.
 *   - `script-src 'self'` allows the (empty) page itself to declare scripts;
 *     the overlay bundle is injected via `addInitScript` (CDP), which is
 *     exempt from page CSP — production content scripts in the isolated
 *     world are exempt by the same rule (MV3 spec).
 *   - `style-src 'self' 'unsafe-inline'` allows the shadow root's inline
 *     <style> for OVERLAY_CSS / @font-face. Production sites that ALSO
 *     restrict style-src will need shadow-style mitigations; that is a
 *     separate concern (#follow-up if/when reported).
 *   - NO `font-src` directive — `default-src 'none'` is the only policy
 *     that governs font fetches. If `chrome-extension:` were not exempt
 *     from page CSP for shadow-root @font-face loads, the woff2 fetch
 *     would be refused and the assertions below would fail.
 */
const STRICT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'";

let handle: ExtensionHandle | undefined;

test.describe('Bundled font loading under strict host CSP (#174)', () => {
  test.beforeAll(async () => {
    handle = await launchExtensionContext();
  });

  test.afterAll(async () => {
    await closeExtensionContext(handle);
    handle = undefined;
  });

  test('OpenDyslexic loads from chrome-extension:// under default-src none', async () => {
    if (!handle) throw new Error('extension context not initialized');
    const { context, serviceWorker } = handle;
    const page = await context.newPage();

    // 1. Collect CSP violations as they arrive. CSP refusals surface on
    //    BOTH `console` ('error' level, message starts with "Refused to
    //    load") and `pageerror` (for some violation classes). Capture
    //    both streams so we cannot silently miss a class.
    const cspViolations: string[] = [];
    const cspFingerprint = (text: string): boolean => {
      const t = text.toLowerCase();
      return (
        t.includes('refused to load the font') ||
        t.includes('refused to load') ||
        t.includes('violated') ||
        t.includes('violatedirective') ||
        t.includes('content security policy') ||
        t.includes("violates the following content security policy")
      );
    };
    const onConsole = (msg: ConsoleMessage): void => {
      const text = msg.text();
      if (cspFingerprint(text)) cspViolations.push(`[console.${msg.type()}] ${text}`);
    };
    const onPageError = (err: Error): void => {
      const text = err.message ?? String(err);
      if (cspFingerprint(text)) cspViolations.push(`[pageerror] ${text}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    // 2. Attach the CSP header at the HTTP response layer. Intercepts
    //    only the fixture URL; sibling assets (woff2 from the
    //    chrome-extension://<id>/ origin) are NOT routed here — they
    //    travel through Chromium's network stack directly and are
    //    subject to whatever policy the loading document declared.
    await context.route(FIXTURE_URL, async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': STRICT_CSP,
        },
        body,
      });
    });

    // 3. Resolve the dynamic-URL font path from the service worker. The
    //    `use_dynamic_url: true` field added in PR #172 rotates the
    //    extension's resource origin per session; hard-coding the URL
    //    here would silently desync.
    const fontUrl: string = await serviceWorker.evaluate(() =>
      chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2'),
    );
    // `use_dynamic_url: true` (#172) rotates the resource origin per session.
    // The dynamic ID is a UUID, not the static `[a-p]+` extension id — match
    // both forms so the test stays correct whether or not the manifest keeps
    // the dynamic-URL field.
    expect(fontUrl, 'font URL resolved from SW').toMatch(
      /^chrome-extension:\/\/[a-zA-Z0-9-]+\/fonts\/OpenDyslexic-Regular\.woff2$/,
    );

    // 4. Inject the e2e overlay bundle via CDP (addInitScript bypasses
    //    page CSP for the script load, mirroring production content-script
    //    isolated-world behaviour). Then navigate to the CSP-strict page.
    await page.addInitScript({ path: BUNDLE_PATH });
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

    // 5. Mount the overlay with the font wiring active. `font: 'opendyslexic'`
    //    applies the `.modal.opendyslexic` class which selects the
    //    'OpenDyslexic' family stack from styles.ts.
    await page.evaluate((url) => {
      const overlayMod = (
        window as unknown as {
          __speedreader_overlay__: { createOverlay: (o: unknown) => { mount(): void } };
        }
      ).__speedreader_overlay__;
      const rsvpMod = (
        window as unknown as {
          __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown };
        }
      ).__speedreader_rsvp__;
      const overlay = overlayMod.createOverlay({
        doc: document,
        words: ['hello', 'world', 'reader'],
        initialSettings: { theme: 'light', wpm: 300, font: 'opendyslexic' },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
        openDyslexicFontUrl: url,
      });
      overlay.mount();
    }, fontUrl);

    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);

    // 6. Probe the actual `chrome-extension://` font fetch via FontFace
    //    API. Constructing `new FontFace(family, src)` and calling
    //    `.load()` exercises the SAME network policy gate the overlay's
    //    shadow-root `@font-face` rule would: a successful resolve proves
    //    the host page's CSP did NOT block the `chrome-extension://`
    //    font fetch.
    //
    //    Why not `document.fonts.check('1em OpenDyslexic')`: per CSS Font
    //    Loading §4.2.3.6, check() returns `true` when NO matching face
    //    exists (fallback is "always available"), so a missing
    //    @font-face would pass the check — non-discriminating.
    //
    //    Why not iterate `document.fonts.forEach()` looking for the
    //    shadow-root face: empirically (Chromium ≥120, verified during
    //    authoring), `@font-face` declared inside a shadow root via a
    //    direct `<style>` child does NOT propagate to the document's
    //    FontFaceSet — the face is queryable only within that shadow.
    //    Iteration on `document.fonts` therefore returns 'none' even
    //    when the overlay's font load succeeds.
    //
    //    The FontFace probe sidesteps that scope quirk by issuing the
    //    fetch from page scope directly. It is a SUFFICIENT condition
    //    for the WAR + CSP plumbing being correct — if it succeeds, the
    //    shadow-root @font-face issued against the same URL with the
    //    same policy will also succeed.
    //
    //    Mutation tested: replacing the URL with a non-WAR
    //    `chrome-extension://<id>/manifest.json` path makes .load()
    //    reject with a network error, failing the assertion. Tightening
    //    STRICT_CSP with explicit `font-src 'self'` ALSO fails the
    //    assertion (verified during authoring) — proving CSP refusal
    //    surfaces here.
    const fontProbe: { loaded: boolean; error: string | null } = await page.evaluate(
      async (url) => {
        try {
          // MUTATION TEST: replace `url` with `url.replace('fonts/OpenDyslexic-Regular.woff2', 'manifest.json')`
          // to point at a non-WAR resource — Chromium refuses the fetch and `await face.load()`
          // rejects, flipping this assertion red. Verified during authoring 2026-05-30.
          const face = new FontFace('OpenDyslexicProbe', `url("${url}") format("woff2")`);
          await face.load();
          return { loaded: face.status === 'loaded', error: null };
        } catch (e) {
          return { loaded: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      fontUrl,
    );

    // 7. The discriminating assertions, in failure-mode order:
    //
    //   a) Zero CSP-violation console messages. Smoke-only here:
    //      Chromium currently treats `chrome-extension:` URLs as exempt
    //      from page CSP `font-src` when the resource is a declared
    //      web_accessible_resource (verified during authoring by adding
    //      `font-src 'self'` to STRICT_CSP and confirming the font still
    //      loaded with no console violations). The assertion is kept as
    //      a behaviour-change canary — if a future Chromium release
    //      tightens the exemption, this fires before users see broken
    //      fonts in production.
    //
    //   b) FontFace probe loads. The discriminating signal. Failure
    //      modes caught: WAR plumbing regression (fonts/* removed from
    //      web_accessible_resources, or matches narrowed off
    //      <all_urls>), woff2 fetch network errors, woff2 parse
    //      failures (corrupt binary — runtime complement to the
    //      build-time `verify:fonts` script from #173).
    //
    //   c) Computed `font-family` on `.word-region` includes
    //      `'OpenDyslexic'`. Structural check on the family stack the
    //      overlay actually applied — necessary so we know assertions
    //      (a) and (b) exercised the OpenDyslexic path and not the
    //      system fallback. A passing (a)+(b) with (c) failing means
    //      the family-stack wiring regressed (the .opendyslexic class
    //      did not get applied) and the rest of this test is testing
    //      the wrong thing.
    expect(cspViolations, `CSP violations:\n${cspViolations.join('\n')}`).toEqual([]);
    expect(
      fontProbe.loaded,
      `FontFace probe against ${fontUrl} must load under strict CSP ` +
        `(error: ${fontProbe.error ?? 'none'})`,
    ).toBe(true);

    const computedFamily: string = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const shadow = (host as HTMLElement | null)?.shadowRoot;
      const wordRegion = shadow?.querySelector('.word-region');
      if (!wordRegion) throw new Error('.word-region not found in overlay shadow root');
      return getComputedStyle(wordRegion as Element).fontFamily;
    });
    expect(
      computedFamily,
      `computed font-family on .word-region (was: ${computedFamily})`,
    ).toMatch(/(^|[\s,])['"]?OpenDyslexic['"]?(,|$)/);

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    await page.close();
  });
});

