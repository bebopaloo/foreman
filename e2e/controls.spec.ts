import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureName } from "./fixtures/sets.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const waivers = (page: Page) => page.getByRole("list", { name: "Waivers" });
const waiverRow = (page: Page, id: string) =>
  waivers(page).getByRole("listitem").filter({ hasText: id });
const releases = (page: Page) => page.getByRole("list", { name: "Releases" });
const releaseRow = (page: Page, name: string) =>
  releases(page).getByRole("listitem").filter({ hasText: name });

test("the nav links Controls in the scope and marks it", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/?client=acme");
  await expect(page.getByRole("link", { name: "Controls" })).toHaveAttribute(
    "href",
    "/controls?client=acme",
  );
  await page.getByRole("link", { name: "Controls" }).click();
  await expect(page).toHaveURL(/\/controls\?client=acme$/);
  await expect(page.getByRole("link", { name: "Controls" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Controls", level: 1 })).toBeVisible();
});

test("the five sections show in order", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  await expect(page.getByRole("heading", { name: "Security artefacts" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Control modules by repo",
    "Escalations",
    "Waivers",
    "Releases",
    "Security artefacts",
  ]);
});

test("the Control modules of each repo show from the repo config", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  const table = page.getByRole("table", { name: "Control modules by repo" });
  const app = table.getByRole("row", { name: /acme\/app/ });
  await expect(app).toContainText("regulated");
  await expect(app).toContainText("6 modules");
  await expect(app).toContainText("Control events on");
  await expect(app).toContainText("Full review data from Control events");
  const site = table.getByRole("row", { name: /acme\/site/ });
  await expect(site).toContainText("none");
  await expect(site).toContainText("Control events off");
  await expect(site).toContainText("Forge data only");
});

test("the Escalations count each path and show the repeated paths note", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  const table = page.getByRole("table", { name: "Escalations by repo and path" });
  const first = table.getByRole("row").nth(1);
  await expect(first).toContainText("src/ledger/transfer.ts");
  await expect(first).toContainText("authority");
  await expect(first).toContainText("src/ledger/transfer.ts:42");
  await expect(first).toContainText("#318");
  await expect(
    page.getByText("1 path escalated 2 or more times. Change the Risk map in a pull request."),
  ).toBeVisible();
});

test("the Waivers show their expiry as text, their covers and their uses", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  await expect(waivers(page).getByRole("listitem")).toHaveCount(4);
  await expect(waiverRow(page, "WAIVER-2")).toContainText("expired");
  await expect(waiverRow(page, "WAIVER-2")).toContainText("used 0 times");
  await expect(waiverRow(page, "WAIVER-7")).toContainText("expires in 14 days");
  await expect(waiverRow(page, "WAIVER-7")).toContainText("used 3 times");
  await expect(waiverRow(page, "WAIVER-4")).toContainText("current, 57 days");
  await expect(waiverRow(page, "WAIVER-4")).toContainText(
    "finding: packages/payments/webhook.ts · Security · CWE-770",
  );
  await expect(waiverRow(page, "WAIVER-9")).toContainText("not in the register at main");
  await expect(waiverRow(page, "WAIVER-9")).toContainText("used 2 times");
});

test("the Releases show the record, the gaps and the open release pull request", async ({
  page,
}) => {
  await useFixture("controls");
  await page.goto("/controls");
  await expect(releases(page).getByRole("listitem")).toHaveCount(4);
  const open = releaseRow(page, "v2.3.0");
  await expect(open).toContainText("open");
  await expect(open).toContainText("release pull request #330");
  await expect(open).toContainText("release review fail");
  await expect(open).toContainText("no Release record before the release");
  const released = releaseRow(page, "v2.2.1");
  await expect(released).toContainText("6 issues");
  await expect(released).toContainText("approved by op-login");
  await expect(released).toContainText("no gaps");
  await expect(released.getByRole("link", { name: /in the forge/ })).toHaveAttribute(
    "href",
    "https://github.com/acme/app/releases/tag/v2.2.1",
  );
  await expect(releaseRow(page, "v2.2.0")).toContainText(
    "3 gaps: 1 Control not proven (CTRL-APP-07), 1 commit with no pull request, Release approval missing",
  );
  await expect(releaseRow(page, "v2.1.0")).toContainText("no forge release");
});

test("the Security artefacts and the Control register list show", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  const artefacts = page.getByRole("list", { name: "Security artefacts by repo" });
  await expect(artefacts).toContainText(
    "Risk map: authority 5, sensitive 3, general 0, inert 1 globs; 2 boundaries",
  );
  await expect(artefacts).toContainText("Control register: 2 Controls");
  await expect(artefacts).toContainText(
    "Threat model: 2 boundaries, 3 threats, 1 with no Control (TM-4), 1 cited Control not in the register (CTRL-OPS-09)",
  );
  await expect(artefacts).toContainText("abcdef0");
  const register = page.getByRole("list", { name: "Control register" });
  await expect(register.getByRole("listitem").filter({ hasText: "CTRL-APP-03" })).toContainText(
    "passing in v2.2.1",
  );
  await expect(register.getByRole("listitem").filter({ hasText: "CTRL-APP-07" })).toContainText(
    "not in a Release record",
  );
});

test("a title and an owner with markup show as plain text", async ({ page }) => {
  await useFixture("controls");
  await page.goto("/controls");
  const row = page
    .getByRole("list", { name: "Control register" })
    .getByRole("listitem")
    .filter({ hasText: "CTRL-APP-03" });
  await expect(row).toContainText('<img src="https://evil.example/t.png"> **Check**');
  await expect(waiverRow(page, "WAIVER-7")).toContainText("<img");
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator('main a[href*="evil.example"]')).toHaveCount(0);
});

test("a repo that is not connected shows Data is not complete", async ({ page }) => {
  await useFixture("controls-incomplete");
  await page.goto("/controls");
  await expect(page.getByRole("heading", { name: "Security artefacts" })).toBeVisible();
  await expect(page.getByText("Data is not complete: 1 repo not connected.")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Repos" }).first()).toHaveAttribute(
    "href",
    "/#dash-repos",
  );
  await expect(waivers(page).getByRole("listitem")).toHaveCount(4);
});

test("with no token the Escalations and the Waiver uses show and the rest says Not connected", async ({
  page,
}) => {
  await useFixture("controls-not-connected");
  await page.goto("/controls");
  await expect(page.getByRole("table", { name: "Escalations by repo and path" })).toBeVisible();
  await expect(page.getByText(/^Not connected\. Add the Foreman token/)).toHaveCount(4);
  await expect(page.getByRole("table", { name: "Control modules by repo" })).toHaveCount(0);
  await expect(waiverRow(page, "WAIVER-7")).toContainText("register not read");
  await expect(waiverRow(page, "WAIVER-7")).toContainText("used 3 times");
  await expect(waiverRow(page, "WAIVER-9")).toContainText("used 2 times");
});

test("the page asks again each 60 seconds", async ({ page }) => {
  await useFixture("controls");
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/controls?**", async (route) => {
    requests += 1;
    await route.continue();
  });
  await page.route("**/api/controls", async (route) => {
    requests += 1;
    await route.continue();
  });
  await page.goto("/controls");
  await expect(waiverRow(page, "WAIVER-7")).toBeVisible();
  const before = requests;
  await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBe(before + 1);
});

test("the page does not scroll sideways at 375 px", async ({ page }) => {
  await useFixture("controls");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/controls");
  await expect(waiverRow(page, "WAIVER-7")).toBeVisible();
  const overflow = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

const AXE_SETS: FixtureName[] = ["controls", "controls-incomplete", "controls-not-connected"];

async function scan(page: Page) {
  await expect(page.getByRole("heading", { name: "Controls", level: 1 })).toBeVisible();
  await expect(page.getByText("Reading the Controls.")).toHaveCount(0);
  await expect(page.getByText("Reading the Waivers.")).toHaveCount(0);
  await expect(page.getByText("Reading the Releases.")).toHaveCount(0);
  await expect(page.getByText("Reading the Control register.")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  for (const name of AXE_SETS) {
    test(`/controls has no WCAG 2.2 AA violations in the ${theme} theme: ${name}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await useFixture(name);
      await page.goto("/controls");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await scan(page);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`a narrow screen has no WCAG 2.2 AA violation in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await useFixture("controls");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/controls");
    await expect(waiverRow(page, "WAIVER-7")).toBeVisible();
    await scan(page);
  });
}
