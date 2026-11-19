import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The randomized accuracy tests compute exact reference roots with BigInt
    // arithmetic, which is slow for roots near 1e-80.
    testTimeout: 120_000,
  },
})
