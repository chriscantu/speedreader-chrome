import { defineConfig } from 'vitest/config';

export default defineConfig({
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
