import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the tests at a running preview. Without it, Playwright
// starts the dev servers itself.
const previewURL = process.env.E2E_BASE_URL;
const baseURL = previewURL ?? "http://127.0.0.1:5173";
const ci = process.env.CI !== undefined;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(previewURL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: baseURL,
          reuseExistingServer: !ci,
          timeout: 60_000,
        },
      }),
});
