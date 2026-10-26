import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "playwright-report",
      "test-results",
      "tests/fixtures/synthetic",
      "tools/train/.venv",
      "tools/train/data",
      "tools/train/out",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // src/solver is pure logic: no DOM, OpenCV, Node or other-module imports.
    files: ["src/solver/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", "window", "document", "navigator", "localStorage"],
      "no-restricted-imports": [
        "error",
        { patterns: ["../ui/*", "../vision/*", "node:*", "opencv*", "onnxruntime*"] },
      ],
    },
  },
  {
    // tools are offline-only and never imported by src.
    files: ["src/**/*.ts"],
    ignores: ["src/solver/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/tools/*"] }],
    },
  },
);
