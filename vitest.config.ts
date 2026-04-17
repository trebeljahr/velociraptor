import { defineConfig } from "vitest/config";

/*
 * Vitest configuration.
 *
 * - happy-dom environment so tests can touch window.localStorage, window,
 *   document, and (eventually) a minimal canvas. Faster than jsdom; enough
 *   for the pure-logic + persistence tests we're writing now.
 * - Collocated tests: src/**\/*.test.ts lives next to the module under test.
 * - Coverage via v8 (Node's built-in profiler) — no Babel/Istanbul overhead.
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/main.ts", // orchestration layer, covered by manual QA
        "src/workers/**", // worker runs inside OffscreenCanvas
      ],
    },
  },
});
