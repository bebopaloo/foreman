import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureName } from "./fixtures/sets.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const pluginTable = (page: Page) => page.getByRole("table", { name: "Plugin versions" });
const runsTable = (page: Page) =>
  page.getByRole("table", { name: "Unattended runs, newest first" });
const ruleList = (page: Page, repo: string) =>
  page.getByRole("list", { name: `Repo rules of ${repo}` });
const ruleRow = (page: Page, repo: string, name: string) =>
  ruleList(page, repo).getByRole("listitem").filter({ hasText: name });

async function loaded(page: Page) {
  await expect(page.getByRole("heading", { name: "Factory health", level: 1 })).toBeVisible();
  await expect(page.getByText(/^Reading the /)).toHaveCount(0);
}

test("the nav links Factory health in the scope and marks it", async ({ page }) => {
  await useFixture("health-bare");
  await page.goto("/?client=acme");
  await expect(page.getByRole("link", { name: "Factory health" })).toHaveAttribute(
    "href",
    "/health?client=acme",
  );
  await page.getByRole("link", { name: "Factory health" }).click();
  await expect(page).toHaveURL(/\/health\?client=acme$/);
  await expect(page.getByRole("link", { name: "Factory health" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the three sections show in order with the plugin, rule and run states", async ({ page }) => {
  await useFixture("health");
  await page.goto("/health");
  await loaded(page);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Plugin versions",
    "Rule drift",
    "Unattended runs",
  ]);

  const plugins = pluginTable(page).getByRole("row");
  await expect(plugins.filter({ hasText: "factory-core@demo-market" })).toContainText(
    "0.37.5 available",
  );
  await expect(plugins.filter({ hasText: "stack-ts@demo-market" })).toContainText("current");
  await expect(page.getByRole("list", { name: "Marketplaces" })).toContainText(
    "Marketplace copy demo-market (github)",
  );
  await expect(
    page.getByText(
      "Foreman makes no network call. A version that is newer than this copy does not show.",
    ),
  ).toBeVisible();

  await expect(
    page.getByText("1 Repo rule behind factory-core 0.30.0, 1 Repo rule edited by the team"),
  ).toBeVisible();
  await expect(ruleRow(page, "acme/app", "coding")).toContainText("current");
  await expect(ruleRow(page, "acme/app", "security")).toContainText(
    "behind: the template changed after 0.8.1",
  );
  await expect(ruleRow(page, "acme/app", "testing")).toContainText("edited by the team");
  await expect(ruleRow(page, "acme/app", "typescript")).toContainText("current");
  await expect(page.getByText("not connected: no token", { exact: true })).toBeVisible();
  await expect(page.getByText(/Data is not complete: 1 repo not connected/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Repos" })).toHaveAttribute("href", "/#dash-repos");

  await expect(runsTable(page).getByRole("row")).toHaveCount(3);
  const newer = runsTable(page).getByRole("row").nth(1);
  const older = runsTable(page).getByRole("row").nth(2);
  await expect(newer).toContainText("1 build: 1 merged");
  await expect(newer).toContainText("peak 1 of 5");
  await expect(older).toContainText("3 builds");
  await expect(older).toContainText("1 skip");
  await expect(older).toContainText("2 stopped items");
  await expect(older.getByRole("listitem").filter({ hasText: "#12" })).toContainText(
    "resumed by the run of",
  );
  await expect(older.getByRole("listitem").filter({ hasText: "#14" })).toContainText(
    "not resumed yet",
  );
});

test("a plugin version or an issue title of markup stays plain text, with no request out", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (request) => {
    hosts.add(new URL(request.url()).hostname);
  });
  await useFixture("health");
  await page.goto("/health");
  await loaded(page);
  await expect(runsTable(page)).toContainText('<img src="https://evil.test/x.png"> **bold**');
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("main a[href*='evil']")).toHaveCount(0);
  await useFixture("health-hostile");
  await page.goto("/health");
  await loaded(page);
  await expect(
    pluginTable(page).getByRole("row").filter({ hasText: "factory-core@demo-market" }),
  ).toContainText("version not readable");
  await expect(page.locator("main img")).toHaveCount(0);
  expect([...hosts].filter((host) => host !== "127.0.0.1")).toEqual([]);
});

test("a folder with no plugin file, no token and no run shows the empty states", async ({
  page,
}) => {
  await useFixture("health-bare");
  await page.goto("/health");
  await loaded(page);
  await expect(page.getByText(/No plugin data:/)).toContainText(
    "installed_plugins.json is missing or not readable",
  );
  await expect(page.getByText(/^Not connected\./)).toContainText("pnpm local:up");
  await expect(page.getByText("No run in the last 30 days")).toBeVisible();
});

test("a run with a fresh lock shows in progress with its builds running", async ({ page }) => {
  await useFixture("health-running");
  await page.goto("/health");
  await loaded(page);
  const row = runsTable(page).getByRole("row").nth(1);
  await expect(row).toContainText("in progress");
  await expect(row).toContainText("–now");
  await expect(row).toContainText("3 builds: 3 running");
});

test("the page asks again for the three routes each 60 seconds", async ({ page }) => {
  await page.clock.install();
  await useFixture("health-bare");
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/factory-health/")) paths.push(url.pathname);
  });
  await page.goto("/health");
  await loaded(page);
  expect([...paths].sort()).toEqual([
    "/api/factory-health/plugins",
    "/api/factory-health/rule-drift",
    "/api/factory-health/runs",
  ]);
  await page.clock.runFor(61_000);
  await expect.poll(() => paths.length).toBe(6);
});

test("at 375 pixels wide the page has no horizontal page scroll", async ({ page }) => {
  await useFixture("health");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/health");
  await loaded(page);
  await expect(runsTable(page)).toBeVisible();
  const overflow = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a set of drift states shows each state as text, and the Stack pack that is not installed", async ({
  page,
}) => {
  await useFixture("health-drift-states");
  await page.goto("/health");
  await loaded(page);
  const rule = (name: string) => ruleRow(page, "acme/app", name);
  await expect(rule("coding")).toContainText("differs from the template");
  await expect(rule("coding")).toContainText(
    "Foreman cannot tell a team edit from a template change.",
  );
  await expect(rule("security")).toContainText("missing at main");
  await expect(rule("testing")).toContainText("file too large");
  await expect(rule("typescript")).toContainText("invalid adapter output");
  await expect(rule("react")).toContainText("adapter error");
  await expect(rule("python")).toContainText("no template in the installed plugins");
  await expect(page.getByText("Stack pack stack-py is not installed")).toBeVisible();
  await expect(
    page.getByText("the main branch in the factory config is release, the default branch is main"),
  ).toBeVisible();
  await expect(ruleRow(page, "acme/site", "coding")).toContainText("current");
});

test("rules that are current with an older stamp or no stamp, and a template name in two plugins", async ({
  page,
}) => {
  await useFixture("health-drift-variants");
  await page.goto("/health");
  await loaded(page);
  const rule = (name: string) => ruleRow(page, "acme/app", name);
  await expect(rule("coding")).toContainText("current, stamp 0.8.1");
  await expect(rule("typescript")).toContainText("current, no stamp");
  await expect(rule("gdpr")).toContainText("current");
  await expect(rule("testing")).toContainText("template name not unique");
});

test("a repo with no factory config, an unreadable one, a missing branch and a failed read", async ({
  page,
}) => {
  await useFixture("health-drift-config");
  await page.goto("/health");
  await loaded(page);
  await expect(page.getByText("not set up: no .claude/factory.json at main")).toBeVisible();
  await expect(page.getByText("factory config not readable")).toBeVisible();
  await expect(page.getByText("branch not found", { exact: true })).toBeVisible();
  await expect(page.getByText("factory config not read: adapter error")).toBeVisible();
});

const AXE_SETS: FixtureName[] = [
  "health-drift-states",
  "health-drift-variants",
  "health-drift-config",
  "health",
  "health-not-connected",
  "health-bare",
  "health-running",
  "health-hostile",
];

for (const theme of ["light", "dark"] as const) {
  for (const name of AXE_SETS) {
    test(`/health has no WCAG 2.2 AA violations in the ${theme} theme: ${name}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await useFixture(name);
      await page.goto("/health");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await loaded(page);
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
