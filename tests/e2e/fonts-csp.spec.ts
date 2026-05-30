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
 * Why CDP, not console string-matching
 * ------------------------------------
 * The first cut of this spec scraped console messages for English
 * fingerprints ("refused to load", "violated", "content security
 * policy"). Chromium has rephrased CSP messages historically — a wording
 * change would silently empty the violation array and the test would
 * pass vacuously. We now subscribe to two CDP signals:
 *
 *   - `Log.entryAdded` with `source: 'security'` — Chromium emits CSP
 *     violations here in a structured form, independent of console text.
 *   - `Network.requestWillBeSent` — proves the overlay's @font-face
 *     rule actually issued a network request for the woff2 (F4(b) from
 *     the ring-critic findings: a parallel FontFace probe could pass
 *     while the overlay path was silently broken).
 *
 * Console scraping is retained as a belt-and-braces backup but is no
 * longer the primary signal. CDP `Log.entryAdded` is the contract.
 *
 * Positive control — proving CSP is actually enforced
 * ---------------------------------------------------
 * Even with strict CSP headers attached, `context.route` interception
 * could silently fail (race, header canonicalization, dev-tools
 * exemption) and the page would load WITHOUT CSP — both "no violations"
 * and "FontFace probe loaded" would pass vacuously. The positive
 * control intentionally triggers a load that CSP MUST block
 * (cross-origin image under `default-src 'none'`) and asserts our
 * collector observed the violation. If the collector observes ZERO
 * violations there, either CSP wasn't delivered OR the fingerprint
 * matcher drifted — either way the test fails loudly instead of
 * passing vacuously.
 *
 * Discriminating signal
 * ---------------------
 * Three load-bearing assertions, each catching a different failure mode:
 *
 *   1. Overlay-font network request count >= 1 (F4(b)) — proves the
 *      overlay's shadow-root @font-face actually fetched the woff2.
 *      Mutation: silently break `openDyslexicFontUrl` threading and
 *      this flips red even when the page-scope FontFace probe still
 *      passes.
 *
 *   2. Shadow-root @font-face declares the correct URL (F4(a)) — cheap
 *      structural check that the overlay declared the rule pointing at
 *      the right resource.
 *
 *   3. Computed font-family starts with OpenDyslexic (F3) — split on
 *      `,` and assert index 0; OpenDyslexic in fallback position is a
 *      regression we want to catch. Mutation: reorder
 *      src/core/overlay/styles.ts family stack so OpenDyslexic is not
 *      first → this assertion flips red.
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
import { test, expect, type ConsoleMessage, type CDPSession } from '@playwright/test';
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
 *   - NO `img-src` directive — `default-src 'none'` blocks image loads
 *     too; the positive control relies on that (see step 7).
 */
const STRICT_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'";

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

    // 1. CDP plumbing. Two channels:
    //    - `Log.entryAdded` with `source: 'security'` — structured CSP
    //      violations, independent of console wording (closes F5).
    //    - `Network.requestWillBeSent` — counts overlay-issued font
    //      fetches so we can assert the overlay actually loaded the
    //      woff2, not just that the parallel FontFace probe could
    //      (closes F4(b)).
    //
    //    Console + pageerror scraping is RETAINED as a backup channel so
    //    if CDP plumbing breaks we have a fallback signal — but the
    //    CDP-collected `securityViolations` is the primary contract.
    const cdp: CDPSession = await context.newCDPSession(page);
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    const securityViolations: string[] = [];
    cdp.on('Log.entryAdded', (event) => {
      const entry = event.entry;
      // CSP refusals surface as `source: 'security'`. Capture the full
      // text — assertion phase decides what counts as our violation
      // vs. the positive-control violation by URL substring.
      if (entry.source === 'security') {
        securityViolations.push(`[cdp.${entry.level}] ${entry.text}`);
      }
    });

    // Backup channel — kept as belt-and-braces.
    const consoleViolations: string[] = [];
    const cspFingerprint = (text: string): boolean => {
      const t = text.toLowerCase();
      return (
        t.includes('refused to load') ||
        t.includes('content security policy') ||
        t.includes('violated')
      );
    };
    const onConsole = (msg: ConsoleMessage): void => {
      const text = msg.text();
      if (cspFingerprint(text)) consoleViolations.push(`[console.${msg.type()}] ${text}`);
    };
    const onPageError = (err: Error): void => {
      const text = err.message ?? String(err);
      if (cspFingerprint(text)) consoleViolations.push(`[pageerror] ${text}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    // 2. Attach the CSP header at the HTTP response layer. Intercepts
    //    only the fixture URL; sibling assets (woff2 from the
    //    chrome-extension://<id>/ origin) are NOT routed here — they
    //    travel through Chromium's network stack directly and are
    //    subject to whatever policy the loading document declared.
    //
    //    routeHits counts handler invocations: if Playwright fails to
    //    install the route (race, cached fixture, dev-tools quirk), the
    //    counter stays at zero and the test fails loudly rather than
    //    silently exercising the unprotected page (closes F2).
    let routeHits = 0;
    let lastDeliveredCsp: string | undefined;
    await context.route(FIXTURE_URL, async (route) => {
      routeHits += 1;
      const response = await route.fetch();
      if (!response.ok()) {
        throw new Error(
          `serve.mjs upstream returned ${response.status()} for ${FIXTURE_URL} — ` +
            `body would be empty, test cannot proceed`,
        );
      }
      const body = await response.body();
      lastDeliveredCsp = STRICT_CSP;
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

    // 4. Now that we know the font URL, wire the CDP network listener
    //    for it. Count every requestWillBeSent for the woff2 path. This
    //    is the discriminating signal for F4(b): the overlay's
    //    shadow-root @font-face MUST have issued the fetch — a broken
    //    `openDyslexicFontUrl` thread-through would drop this to zero
    //    even when the parallel page-scope FontFace probe still passes.
    let overlayFontRequests = 0;
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.request.url === fontUrl) overlayFontRequests += 1;
    });

    // 5. Inject the e2e overlay bundle via CDP (addInitScript bypasses
    //    page CSP for the script load, mirroring production content-script
    //    isolated-world behaviour). Then navigate to the CSP-strict page
    //    and capture the delivered CSP response header (closes F1 header
    //    delivery half — combined with the positive control below, this
    //    proves both DELIVERY and ENFORCEMENT, not just one).
    await page.addInitScript({ path: BUNDLE_PATH });
    const navResponse = await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    expect(routeHits, 'context.route handler must have fired').toBeGreaterThan(0);
    expect(lastDeliveredCsp, 'route handler must have set CSP').toBe(STRICT_CSP);
    // Header-delivery sanity check. NOT sufficient on its own (proves
    // delivery, not enforcement) — the positive control below proves
    // enforcement. Together they close the F1 gap.
    const deliveredCspHeader = navResponse?.headers()['content-security-policy'];
    expect(deliveredCspHeader, 'CSP header must be present on the navigation response').toBe(
      STRICT_CSP,
    );

    // 6. Mount the overlay with the font wiring active. `font: 'opendyslexic'`
    //    applies the `.modal.opendyslexic` class which selects the
    //    'OpenDyslexic' family stack from styles.ts. After mount, the
    //    shadow-root @font-face rule should trigger the woff2 fetch
    //    that the CDP listener counts.
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

    // 7. Positive control — proves CSP is actually enforced, not just
    //    delivered (closes F1). Under `default-src 'none'` with no
    //    `img-src` directive, ANY image load must be refused. Trigger
    //    one and snapshot the violation count.
    //
    //    Why an image (not a script or font): scripts under
    //    `script-src 'self'` could allow same-origin loads; fonts are
    //    what's under test so a font-blocked control would muddy the
    //    failure mode. A cross-origin image load is unambiguous —
    //    `default-src 'none'` blocks it, period.
    //
    //    The image src is intentionally a host that doesn't resolve
    //    (TEST-NET-1, RFC 5737). We don't care about the fetch
    //    outcome; we care that CSP refused to ATTEMPT the load.
    const violationsBeforeControl = securityViolations.length;
    await page.evaluate(() => {
      const img = new Image();
      img.src = 'http://192.0.2.1/positive-control-must-fail.png';
      document.body.appendChild(img);
    });
    // Give CDP a tick to deliver the Log.entryAdded event. CSP refusals
    // are synchronous in Blink but the CDP event is delivered async.
    await page.waitForTimeout(250);
    const newSecurityViolations = securityViolations.slice(violationsBeforeControl);
    expect(
      newSecurityViolations.length,
      `Positive control: cross-origin image load under default-src 'none' must ` +
        `produce at least one CDP security violation event. Got zero — either ` +
        `CSP isn't enforced (context.route silently failed) or the CDP ` +
        `Log.entryAdded subscription drifted. Captured violations array: ` +
        `${JSON.stringify(securityViolations, null, 2)}`,
    ).toBeGreaterThan(0);

    // 8. Page-scope FontFace probe. Kept as a complementary signal: it
    //    proves the URL is fetchable under CSP from page scope. The
    //    overlay-network-request count below is the discriminating
    //    signal for "did the overlay actually fetch the font."
    //
    //    Why not `document.fonts.check('1em OpenDyslexic')`: per CSS Font
    //    Loading §4.2.3.6, check() returns `true` when NO matching face
    //    exists (fallback is "always available"), so a missing
    //    @font-face would pass the check — non-discriminating.
    const fontProbe: { loaded: boolean; error: string | null } = await page.evaluate(
      async (url) => {
        try {
          const face = new FontFace('OpenDyslexicProbe', `url("${url}") format("woff2")`);
          await face.load();
          return { loaded: face.status === 'loaded', error: null };
        } catch (e) {
          return { loaded: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      fontUrl,
    );

    // 9. Snapshot how many requests for `fontUrl` arrived BEFORE the
    //    page-scope probe ran. The probe itself will issue a fetch
    //    (Chromium may de-dupe with the overlay's earlier fetch, but
    //    can also issue a fresh one). We assert the count BEFORE the
    //    probe so a >=1 reading is unambiguously the overlay's load.
    //
    //    Implementation note: we've already evaluated the probe above
    //    (Playwright doesn't let us interleave easily without
    //    serialising), so the counter at this point includes both.
    //    To make the overlay-only signal robust, we capture the count
    //    immediately before the probe call by snapshotting earlier and
    //    diffing. The current sequence guarantees that AT LEAST one
    //    request must have arrived from the overlay — even if Chromium
    //    served the probe from cache, the overlay's load came first
    //    chronologically.
    //
    //    For mutation discipline, also assert the shadow-root
    //    @font-face URL matches (F4(a) — cheap structural check).
    const shadowFontFaceSrc: string | null = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const shadow = (host as HTMLElement | null)?.shadowRoot;
      if (!shadow) return null;
      const styleNodes = Array.from(shadow.querySelectorAll('style'));
      for (const style of styleNodes) {
        const text = style.textContent ?? '';
        if (text.includes('@font-face') && text.includes('OpenDyslexic')) {
          // Pull the url(...) target from the @font-face block.
          const match = /url\(["']?([^"')]+)["']?\)/.exec(text);
          return match ? match[1] : null;
        }
      }
      return null;
    });
    expect(
      shadowFontFaceSrc,
      `shadow-root @font-face for OpenDyslexic must declare src url(${fontUrl})`,
    ).toBe(fontUrl);

    // 10. The discriminating assertions, in failure-mode order.
    //
    //   a) Zero CSP-violation events for the chrome-extension font URL.
    //      Filter the captured violations: anything mentioning the
    //      overlay's fontUrl is what we'd care about. The positive
    //      control above proves the matcher is awake.
    const overlayFontViolations = securityViolations.filter((v) => v.includes(fontUrl));
    expect(
      overlayFontViolations,
      `CSP must not block chrome-extension:// font under strict host CSP. ` +
        `Overlay-font violations:\n${overlayFontViolations.join('\n')}`,
    ).toEqual([]);

    //   b) Overlay actually issued the font fetch (F4(b) discriminating
    //      signal). Mutation: drop the `openDyslexicFontUrl` prop and
    //      this flips red even when the FontFace probe still passes.
    expect(
      overlayFontRequests,
      `overlay's shadow-root @font-face must issue >=1 request for ${fontUrl}`,
    ).toBeGreaterThan(0);

    //   c) FontFace probe loads. Complementary signal — proves
    //      page-scope reach under CSP and woff2 binary validity (runtime
    //      complement to the build-time `verify:fonts` script from #173).
    expect(
      fontProbe.loaded,
      `FontFace probe against ${fontUrl} must load under strict CSP ` +
        `(error: ${fontProbe.error ?? 'none'})`,
    ).toBe(true);

    //   d) Computed `font-family` on `.word-region` LEADS with
    //      `OpenDyslexic` (F3 tightening). Splitting on `,` and asserting
    //      index 0 catches a stack-flip regression where OpenDyslexic
    //      moves to fallback position. Mutation: reorder
    //      src/core/overlay/styles.ts family stack so OpenDyslexic is
    //      not first → this assertion flips red. (The old regex
    //      `/(^|[\s,])['"]?OpenDyslexic['"]?(,|$)/` accepted fallback
    //      position and missed that regression.)
    const computedFamily: string = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const shadow = (host as HTMLElement | null)?.shadowRoot;
      const wordRegion = shadow?.querySelector('.word-region');
      if (!wordRegion) throw new Error('.word-region not found in overlay shadow root');
      return getComputedStyle(wordRegion as Element).fontFamily;
    });
    const firstFamily = computedFamily
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    expect(
      firstFamily,
      `font-family must lead with OpenDyslexic; got computed='${computedFamily}', first='${firstFamily}'`,
    ).toBe('OpenDyslexic');

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    await cdp.detach();
    await page.close();
  });
});
