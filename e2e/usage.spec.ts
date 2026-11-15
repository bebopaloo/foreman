import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureName } from "./fixtures/sets.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.use({ timezoneId: "Europe/London" });

const tile = (page: Page, name: string) => page.getByRole("region", { name });
const chartRows = (page: Page, name: string) =>
  page
    .getByRole("table", { name })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

test("the page shows the defaults, the tokens tile and Usage over time", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage");
  const tokens = tile(page, "Tokens, last 14 days");
  await expect(tokens).toContainText("11.4M");
  await expect(tokens).toContainText(/List-price estimate \$\d/);
  await expect(tokens).toContainText("2 turns unpriced (model synthetic-model-x)");
  await expect(tokens).toContainText("It is not what your subscription charges.");
  await expect(chartRows(page, "Tokens by day")).toHaveCount(14);
  await expect(page).toHaveURL(/range=14d/);
  await expect(page).toHaveURL(/grain=day/);
  await expect(page).toHaveURL(/metric=tokens/);
  await expect(page).toHaveURL(/tab=project/);
  await expect(page.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Usage data as of")).toBeVisible();
  await expect(page.getByText("Times in Europe/London")).toBeVisible();
});

test("a client scope shows only its usage and sends no request to /limits", async ({ page }) => {
  await useFixture("usage");
  const limitRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/usage/limits")) limitRequests.push(request.url());
  });
  await page.goto("/usage?client=acme");
  await expect(tile(page, "Tokens, last 14 days")).toContainText("8M");
  await expect(
    page.getByText("Limit windows are plan-wide. They show only in the scope All."),
  ).toBeVisible();
  await expect(tile(page, "Tokens, last 14 days")).not.toContainText("unpriced");
  expect(limitRequests).toEqual([]);
});

test("the metric, the range and Back change the page and the URL", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage");
  await expect(tile(page, "Tokens, last 14 days")).toContainText("11.4M");
  await page.getByRole("radio", { name: "Turns" }).check();
  await expect(page.getByRole("table", { name: "Turns by day" })).toBeAttached();
  await expect(page).toHaveURL(/metric=turns/);
  await page.getByLabel("Range").selectOption("30d");
  await expect(tile(page, "Tokens, last 30 days")).toContainText("11.5M");
  await expect(page).toHaveURL(/range=30d/);
  await page.goBack();
  await expect(tile(page, "Tokens, last 14 days")).toContainText("11.4M");
  await expect(page.getByRole("radio", { name: "Turns" })).toBeChecked();
  await page.goBack();
  await expect(page.getByRole("radio", { name: "Tokens" })).toBeChecked();
});

test("two chosen dates give an absolute range", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage");
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-31");
  await expect(page).toHaveURL(/from=2026-10-01&.*to=2026-10-31/);
  await expect(page).not.toHaveURL(/range=/);
  await expect(tile(page, "Tokens, 1 Oct 2026 to 31 Oct 2026")).toBeVisible();
});

test("a link with values that are not valid shows the defaults and a message", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage?range=0d&grain=hour&metric=cost");
  await expect(
    page.getByText("The link has a value that is not valid. The page shows the defaults for it."),
  ).toBeVisible();
  await expect(tile(page, "Tokens, last 14 days")).toContainText("11.4M");
  await expect(page).toHaveURL(/range=14d&grain=day&metric=tokens/);
});

test("no usage in the range shows one sentence in each panel", async ({ page }) => {
  await useFixture("usage-empty");
  await page.goto("/usage");
  await expect(page.getByText("No usage in this range in this scope.")).toHaveCount(3);
});

test("the By Project table opens a Project page, and a tab shows its table", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage");
  const projects = page.getByRole("table", { name: "Usage by Project" });
  await expect(projects.getByRole("row")).toHaveCount(5);
  await expect(projects.getByRole("row").last()).toContainText("Total");
  await expect(projects.getByRole("cell", { name: "Unassigned" })).toBeVisible();
  await page.getByRole("tab", { name: "Model" }).click();
  await expect(page).toHaveURL(/tab=model/);
  await expect(page.getByRole("table", { name: "Usage by Model" })).toBeVisible();
  await expect(page.getByRole("link", { name: "synthetic-priced-1" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("table", { name: "Usage by Project" })).toBeVisible();

  await projects.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/usage\/projects\/[0-9a-f]{12}\?.*range=14d/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("acme");
  await expect(page.getByRole("tab")).toHaveText([
    "Model",
    "Agent type",
    "Skill",
    "Branch",
    "Session",
  ]);
  await expect(page.getByRole("table", { name: "Usage by Model" })).toBeVisible();
  await expect(tile(page, "Tokens, last 14 days")).toContainText("8M");
});

test("a Project outside the scope shows a message and asks for no usage", async ({ page }) => {
  await useFixture("usage");
  await page.goto("/usage");
  const outside = page
    .getByRole("table", { name: "Usage by Project" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "bebopaloo", exact: true }) })
    .getByRole("link");
  const href = (await outside.getAttribute("href")) ?? "";
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/usage\/(breakdown|series)/.test(request.url())) requests.push(request.url());
  });
  await page.goto(`${href.split("?")[0] ?? ""}?client=acme`);
  await expect(page.getByText("No such Project in this scope.")).toBeVisible();
  await page.goto("/usage/projects/ffffffffffff?client=acme");
  await expect(page.getByText("No such Project in this scope.")).toBeVisible();
  expect(requests).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`a Project page has no WCAG 2.2 AA violations in the ${scheme} theme`, async ({ page }) => {
    await useFixture("usage");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/usage");
    await page.getByRole("table", { name: "Usage by Project" }).getByRole("link").first().click();
    await expect(page.getByRole("table", { name: "Usage by Model" })).toBeVisible();
    await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(results.violations).toEqual([]);
  });
}

const AXE_SETS: { name: FixtureName; path: string }[] = [
  { name: "usage", path: "/usage" },
  { name: "usage", path: "/usage?client=acme" },
  { name: "usage-empty", path: "/usage" },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { name, path } of AXE_SETS) {
    test(`the page has no WCAG 2.2 AA violations in the ${scheme} theme: ${name} ${path}`, async ({
      page,
    }) => {
      await useFixture(name);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.getByText("Usage data as of")).toBeVisible();
      await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test("at 375 pixels wide the page has no horizontal page scroll", async ({ page }) => {
  await useFixture("usage");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/usage");
  await expect(tile(page, "Tokens, last 14 days")).toContainText("11.4M");
  const overflow: unknown = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toEqual(expect.any(Number));
  expect(Number(overflow)).toBeLessThanOrEqual(0);
});
