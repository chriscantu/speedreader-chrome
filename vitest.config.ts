import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/core/**/*.test.ts', 'src/core/**/__tests__/**/*.test.ts'],
    exclude: ['src/chrome/**', 'node_modules/**', 'dist/**'],
  },
});
