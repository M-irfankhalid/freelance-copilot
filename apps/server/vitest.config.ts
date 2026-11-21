import { defineConfig } from "vitest/config";

/**
 * `tsc` compiles tests into dist/tests as a side effect of building. Without
 * an explicit include, Vitest also picks up those compiled copies and runs
 * every test twice.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
