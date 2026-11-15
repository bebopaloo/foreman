import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["*.ts"],
      exclude: ["*.test.ts", "vitest.config.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 80 },
    },
  },
});
