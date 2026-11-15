import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Integration tests share one database.
    fileParallelism: false,
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/migrate.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 80 },
    },
  },
});
