import { createServer, type Server } from "node:net";
import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the tests at a running preview. Without it, Playwright
// starts the dev servers itself, on free ports, so two worktrees can run their
// end-to-end tests at the same time.
const previewURL = process.env.E2E_BASE_URL;
const ci = process.env.CI !== undefined;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("No port"));
      else resolve(address.port);
    });
  });
}

// All servers stay open until every port is known, so the ports differ.
async function freePorts(count: number): Promise<string[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    const ports = await Promise.all(servers.map(listen));
    return ports.map(String);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

// Playwright loads this file again in each worker. The first load keeps the
// ports in the environment, which the workers inherit.
if (
  previewURL === undefined &&
  (process.env.E2E_WEB_PORT === undefined || process.env.E2E_API_PORT === undefined)
) {
  const [webPort, apiPort] = await freePorts(2);
  process.env.E2E_WEB_PORT ??= webPort;
  process.env.E2E_API_PORT ??= apiPort;
}

const devURL = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? ""}`;
const baseURL = previewURL ?? devURL;

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
          url: devURL,
          reuseExistingServer: !ci,
          timeout: 60_000,
          // WEB_PORT is the Vite port. PORT is the API port, which the Vite
          // proxy also reads.
          env: {
            WEB_PORT: process.env.E2E_WEB_PORT ?? "",
            PORT: process.env.E2E_API_PORT ?? "",
            CORS_ORIGINS: devURL,
          },
        },
      }),
});
