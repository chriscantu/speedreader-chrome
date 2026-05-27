import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    files: ["**/*.ts"],
    rules: {
      // TypeScript-specific rules
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // D10 reproducer + future experiments/ MV3 sandbox scripts.
    // These are real Chrome extensions loaded unpacked, not project source —
    // they need WebExtension + browser globals available to the linter.
    files: ["experiments/**/*.js", "experiments/**/*.ts"],
    languageOptions: {
      globals: {
        chrome: "readonly",
        console: "readonly",
        document: "readonly",
        location: "readonly",
        window: "readonly",
        self: "readonly",
        globalThis: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLIFrameElement: "readonly",
        Element: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // Playwright e2e specs + fixtures (issue #38). These run under Node
    // for the harness layer and inside Chromium / SW contexts for the
    // evaluate() blocks; surface the same globals the experiments/ block
    // declares so the linter doesn't choke on `chrome`, `self`, etc.
    files: ["tests/e2e/**/*.ts", "tests/e2e/**/*.mjs", "playwright.config.ts"],
    languageOptions: {
      globals: {
        chrome: "readonly",
        console: "readonly",
        document: "readonly",
        location: "readonly",
        window: "readonly",
        self: "readonly",
        globalThis: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-e2e/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".claude/**",
      ".claude-flow/**",
    ],
  }
);