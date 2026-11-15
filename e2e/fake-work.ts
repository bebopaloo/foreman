import type { Page } from "@playwright/test";

// The real API reads the repo list of the machine, so the tests fake the work routes. The default gives two clients and a failed fetch.
export async function fakeWork(page: Page, options: { clients?: boolean } = {}) {
  await page.route("**/api/work/clients", (route) =>
    route.fulfill({
      json: {
        clients:
          options.clients === false
            ? []
            : [
                { name: "acme", repoCount: 2 },
                { name: "bebopaloo", repoCount: 1 },
              ],
        unassignedCount: options.clients === false ? 0 : 1,
      },
    }),
  );
  await page.route("**/api/work/repos", (route) =>
    route.fulfill({
      json: {
        repos: [
          {
            id: "0123456789ab",
            fullName: "acme/app",
            host: "github.com",
            client: "acme",
            state: "connected",
            dataAsOf: "2026-11-15T09:42:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/work/status", (route) =>
    route.fulfill({
      json: {
        state: options.clients === false ? "idle" : "failed",
        reason: options.clients === false ? null : "forge timeout",
        lastFetchStartedAt: null,
        lastFetchAt: null,
        lastFullFetchStartedAt: null,
        lastFullFetchAt: null,
        problems: [],
        owners: [{ host: "github.com", owner: "acme", state: "connected" }],
        repos: [],
      },
    }),
  );
}
