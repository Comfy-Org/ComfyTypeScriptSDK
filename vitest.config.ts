import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Report on every source file, not just the ones a test happened to
      // import — otherwise a module with no test at all is invisible rather
      // than showing up as 0%.
      include: ["src/**/*.ts"],
      exclude: [
        // openapi-ts output, checked byte-for-byte by the spec-drift gate
        // rather than exercised as hand-written code. Counted 100% and
        // inflated the total, hiding real coverage of the SDK itself.
        "src/low/generated/**",
        // Written by scripts/gen-version.mjs at build time.
        "src/low/version.ts",
        "src/**/*.test.ts",
      ],
    },
  },
});
