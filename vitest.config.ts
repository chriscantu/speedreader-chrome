import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Tiny Vite plugin that resolves `*?script` imports (the crxjs vite-plugin
 * pattern for referencing a script entry from another extension surface)
 * to a string default-export carrying the file's basename. The real plugin
 * is registered by `vite.config.ts` for production builds; vitest runs
 * without the crx plugin, so without this stub the bare `import x from
 * './foo.ts?script'` fails to resolve. The stub is intentionally inert —
 * tests assert on the resolved string itself (e.g., "must end in `.js`").
 */
const SCRIPT_STUB_PREFIX = 'virtual:script-stub/';

function scriptQueryStub(): Plugin {
  return {
    name: 'speedreader-test:script-query-stub',
    enforce: 'pre',
    resolveId(id) {
      // Match `*?script`, `*?script&loader`, `*?script&iife`, `*?script&module`.
      const match = id.match(/^(.+?)\?script(?:&[a-z]+)?$/);
      if (!match) return null;
      const raw = match[1] ?? '';
      // Strip leading `./` / `../` segments so the encoded id has no path
      // chars vitest/rolldown will try to re-resolve. The recovered path is
      // only used to derive a basename in `load`.
      const encoded = raw.replace(/[./]/g, '_');
      return `${SCRIPT_STUB_PREFIX}${encoded}|${encodeURIComponent(raw)}`;
    },
    load(id) {
      if (!id.startsWith(SCRIPT_STUB_PREFIX)) return null;
      const tail = id.slice(SCRIPT_STUB_PREFIX.length);
      const sep = tail.lastIndexOf('|');
      const raw = sep === -1 ? tail : decodeURIComponent(tail.slice(sep + 1));
      // Swap `.ts` for `.js` so tests observe the same emitted-name shape
      // crxjs produces in real builds (filename with a `.js` extension,
      // not `.ts`).
      const filename = raw.replace(/\.ts$/, '.js');
      return `export default ${JSON.stringify(filename)};`;
    },
  };
}

export default defineConfig({
  plugins: [scriptQueryStub()],
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/core/**/*.test.ts',
      'src/core/**/__tests__/**/*.test.ts',
      // Narrow inclusion: settings adapter + background activation/messaging/
      // state modules. Rest of src/chrome/** stays excluded — those surfaces
      // are integration-tested via Playwright (#38).
      'src/chrome/settings/**/__tests__/**/*.test.ts',
      'src/chrome/background/activation/**/__tests__/**/*.test.ts',
      'src/chrome/background/messaging/**/__tests__/**/*.test.ts',
      'src/chrome/background/state/**/__tests__/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
