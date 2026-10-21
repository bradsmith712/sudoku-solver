/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // vite-node's default-export interop wraps CJS deps in a Proxy that forwards
    // `then` to the module. OpenCV.js has its own `then`, so importing it would hang.
    deps: { interopDefault: false },
  },
});
