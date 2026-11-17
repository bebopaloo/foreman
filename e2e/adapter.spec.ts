import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adapterCalls, SYNTHETIC_HOST } from "./fixtures/adapter/index.ts";
import { LIVE_CLAUDE_DIR, useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const table = (page: Page) => page.getByRole("table", { name: "Issues and pull requests" });
const rowOf = (page: Page, text: string) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") })
    .filter({ hasText: text });

const SYNTHETIC_FORGE_SCRIPT = "plugins/cache/synthetic/synthetic-forge/1.0.0/e2e_adapter.py";
const SYNTHETIC_TRACKER_SCRIPT = "plugins/cache/synthetic/synthetic-tracker/1.0.0/e2e_adapter.py";

test("a set with an adapter is connected through a real fetch of the synthetic adapter", async ({
  page,
}) => {
  await useFixture("fetch-connected");
  await page.goto("/work?client=acme");
  await expect(rowOf(page, "Fetched export")).toBeVisible();
  await expect(rowOf(page, "Fetched footer")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Issue 21 of acme/app in the tracker" }),
  ).toHaveAttribute("href", `https://${SYNTHETIC_HOST}/acme/app/issues/21`);
  await expect(
    page.getByRole("link", { name: "Pull request 60 of acme/app in the forge" }),
  ).toHaveAttribute("href", `https://${SYNTHETIC_HOST}/acme/app/pull/60`);
  await expect(page.getByText(/Data is not complete/)).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
});

test("a set with an owner without a token and a failed command is partly connected", async ({
  page,
}) => {
  await useFixture("fetch-partial");
  await page.goto("/work");
  await expect(rowOf(page, "Fetched export")).toBeVisible();
  await expect(rowOf(page, "Fetched footer")).toBeVisible();
  // `bebopaloo/tools` has no token, and `acme/site` failed one command.
  await expect(page.getByText("Data is not complete: 2 repos not connected.")).toBeVisible();
  await expect(page.getByText("Fetched guide")).toHaveCount(0);
  const calls = [...(await adapterCalls(LIVE_CLAUDE_DIR, "tracker"))];
  expect(calls.map((call) => call.repo)).not.toContain("bebopaloo/tools");
  expect(calls.map((call) => call.repo)).toContain("acme/site");
});

test("a set with no token is not connected and the adapter is never called", async ({ page }) => {
  await useFixture("fetch-not-connected");
  await page.goto("/work");
  await expect(
    page.getByText(/Not connected\. Add the Foreman token to FOREMAN_TOKENS_JSON/),
  ).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  expect(await adapterCalls(LIVE_CLAUDE_DIR, "tracker")).toEqual([]);
  expect(await adapterCalls(LIVE_CLAUDE_DIR, "forge")).toEqual([]);
});

test("the API runs the synthetic adapter only, and no request leaves the machine", async ({
  page,
}) => {
  await useFixture("fetch-real-host");
  await page.goto("/work?client=acme");
  await expect(rowOf(page, "Fetched export")).toBeVisible();
  await expect(page.getByText("Real host issue")).toHaveCount(0);

  const forge = await adapterCalls(LIVE_CLAUDE_DIR, "forge");
  const tracker = await adapterCalls(LIVE_CLAUDE_DIR, "tracker");
  expect(forge.length).toBeGreaterThan(0);
  expect(tracker.length).toBeGreaterThan(0);
  // The resolved adapter is the script of the synthetic plugin in the synthetic Claude folder.
  for (const call of forge) expect(call.script.endsWith(SYNTHETIC_FORGE_SCRIPT)).toBe(true);
  for (const call of tracker) expect(call.script.endsWith(SYNTHETIC_TRACKER_SCRIPT)).toBe(true);
  // The repo on the real host has a token, but the host is not allowed: no command reaches an adapter.
  for (const call of [...forge, ...tracker]) {
    expect(call.host).toBe(SYNTHETIC_HOST);
    expect(call.repo).not.toBe("acme/real");
  }
  const response = await page.request.get("/api/work/status");
  const status = JSON.stringify(await response.json());
  expect(status).toContain("host not allowed");
});
