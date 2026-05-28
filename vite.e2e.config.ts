import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist-e2e',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'tests/e2e/fixtures/overlay-bundle-entry.ts'),
      name: '__speedreader_e2e__',
      formats: ['iife'],
      fileName: () => 'core-overlay-bundle.js',
    },
    target: 'chrome88',
  },
});
