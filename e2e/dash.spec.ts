import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { useFixture } from "./fixtures/use-fixture.ts";
import type { FixtureName } from "./fixtures/sets.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const now = (page: Page) => page.getByRole("region", { name: "Now" });

test("a run in progress shows the heartbeat age", async ({ page }) => {
  await useFixture("run-in-progress");
  await page.goto("/");
  await expect(now(page)).toContainText("Run in progress");
  await expect(now(page)).toContainText("heartbeat 4 minutes ago");
});

test("a stale lock shows no run and the reason", async ({ page }) => {
  await useFixture("stale-lock");
  await page.goto("/");
  await expect(now(page)).toContainText("No run in progress");
  await expect(now(page)).toContainText("a stopped run left a stale lock");
});

test("no night log and no lock shows no run, with no error", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/");
  await expect(now(page)).toContainText("No run in progress");
  await expect(page.getByText(/cannot read|unreadable|stale/)).toHaveCount(0);
});

test("a lock that is not valid shows run lock unreadable", async ({ page }) => {
  await useFixture("unreadable-lock");
  await page.goto("/");
  await expect(now(page)).toContainText("run lock unreadable");
});

test("malformed lines do not stop the dash and show in the API counts", async ({
  page,
  request,
}) => {
  await useFixture("malformed-lines");
  await page.goto("/");
  await expect(now(page)).toContainText("No run in progress");
  const response = await request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? ""}/api/dash`);
  const body = (await response.json()) as { skipped: unknown };
  expect(body.skipped).toEqual({ nightLogLines: 1, controlEvents: 1, files: 0, lock: 0 });
});

test("the dash asks for new data each 60 seconds while the tab is visible", async ({ page }) => {
  await useFixture("no-run");
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/dash**", async (route) => {
    requests += 1;
    await route.continue();
  });
  await page.goto("/");
  await expect(now(page)).toContainText("No run in progress");
  expect(requests).toBe(1);
  await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBe(2);
});

const lastRun = (page: Page) => page.getByRole("region", { name: "Last run" });
const buildRows = (page: Page) =>
  lastRun(page)
    .getByRole("table", { name: "Builds of the last run" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

test("a run in progress shows open bars in Last run", async ({ page }) => {
  await useFixture("run-in-progress");
  await page.goto("/");
  await expect(buildRows(page)).toHaveCount(3);
  await expect(lastRun(page)).toContainText("Run in progress");
  await expect(lastRun(page).getByTitle(/: running$/)).toHaveCount(3);
});

test("no run in the last 30 days shows that in Last run", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/");
  await expect(lastRun(page)).toContainText("No run in the last 30 days");
});

test("the slot timeline shows lanes, results, skips and blocked at selection", async ({ page }) => {
  await useFixture("last-run");
  await page.goto("/");
  await expect(lastRun(page)).toContainText("9 skips");
  await expect(lastRun(page)).toContainText("1 blocked at selection");
  const rows = await buildRows(page).evaluateAll((elements) =>
    elements.map((row) =>
      [...row.querySelectorAll("td")]
        .map((cell) => cell.textContent)
        .filter((_, index) => [0, 2, 5].includes(index))
        .join(" "),
    ),
  );
  expect(rows).toEqual([
    "1 21 merged",
    "2 22 merge-ready",
    "3 24 stopped at run end",
    "1 23 blocked",
  ]);
  await expect(lastRun(page).getByTitle(/#30:/)).toHaveCount(0);
  await expect(lastRun(page).getByTitle("acme/app #23: blocked")).toBeVisible();
});

test("a client scope shows the older run of that client, with its own lanes", async ({ page }) => {
  await useFixture("last-run-clients");
  await page.goto("/?client=acme");
  await expect(lastRun(page)).toContainText("run-synthetic-old");
  const lanes = await buildRows(page).evaluateAll((elements) =>
    elements.map((row) => row.querySelector("td")?.textContent),
  );
  expect(lanes).toEqual(["1", "2"]);
  await page.goto("/");
  await expect(lastRun(page)).toContainText("run-synthetic-new");
});

const AXE_SETS: FixtureName[] = [
  "last-run",
  "run-in-progress",
  "stale-lock",
  "no-run",
  "not-connected",
];

for (const name of AXE_SETS) {
  test(`the dash has no WCAG 2.2 AA violations: ${name}`, async ({ page }) => {
    await useFixture(name);
    await page.goto("/");
    await expect(now(page)).toContainText(/in progress/);
    const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(results.violations).toEqual([]);
  });
}
