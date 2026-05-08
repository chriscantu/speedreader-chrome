import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/chrome/manifest';

export default defineConfig({
  plugins: [
    crx({
      manifest,
      browser: 'chrome',
    }),
  ],
  build: {
    minify: true,
    outDir: 'dist',
  },
});