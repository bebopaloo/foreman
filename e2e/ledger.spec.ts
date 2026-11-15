import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ledgerDay } from "./fixtures/ledger-transcripts.ts";
import { useFixture } from "./fixtures/use-fixture.ts";
import type { FixtureName } from "./fixtures/sets.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const NOW = new Date();
const TODAY = ledgerDay(NOW);
/** A range that holds the day of the fixture even when the ledger zone is a day ahead of UTC. */
const RANGE = `from=${ledgerDay(NOW, 30)}&to=${TODAY}`;
const LONG_RANGE = `from=${ledgerDay(NOW, 200)}&to=${TODAY}`;
const EMPTY_RANGE = "from=2020-01-01&to=2020-01-31";
const EMPTY = "No messages and no usage in this range in this scope.";

const shown = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const table = (page: Page, name: string) => page.getByRole("table", { name });

test("the page shows the rule, the summary by client repo and the days", async ({ page }) => {
  await useFixture("ledger", NOW);
  await page.goto(`/ledger?${RANGE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Engagement ledger" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Engagement ledger" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByText(
      "Each of your messages adds the time since your previous message, when that time is 15 minutes or less. Else it adds 2 minutes. Days are in Europe/London.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Usage data as of")).toBeVisible();

  const repos = table(page, "By client repo");
  const app = repos.getByRole("row", { name: /acme\/app/ });
  await expect(app).toContainText("acme");
  await expect(app).toContainText("0 h 29 min");
  await expect(app).toContainText("1.5M");
  await expect(repos.getByRole("row", { name: /bebopaloo\/tools/ })).toContainText("0 h 2 min");
  // A project outside the repo list is last, with the client "Unassigned".
  const lines = repos.locator("tbody tr");
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(2)).toContainText("spike-cli");
  await expect(lines.nth(2)).toContainText("Unassigned");
  await expect(repos.getByRole("row", { name: /^Total/ })).toContainText("0 h 33 min");

  const days = table(page, "By day").locator("tbody tr");
  await expect(days).toHaveCount(3);
  await expect(days.first()).toContainText(shown(TODAY));
  await expect(table(page, "By day").getByRole("row", { name: /acme\/app/ })).toContainText("5");
});

test("a Client scope shows only the rows of that client and keeps the time of each row", async ({
  page,
}) => {
  await useFixture("ledger", NOW);
  await page.goto(`/ledger?${RANGE}&client=acme`);
  const lines = table(page, "By client repo").locator("tbody tr");
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText("acme/app");
  await expect(lines.first()).toContainText("0 h 29 min");
  await expect(page.getByText("spike-cli")).toHaveCount(0);
});

test("Show more loads the rest of 130 rows", async ({ page }) => {
  await useFixture("ledger-long", NOW);
  await page.goto(`/ledger?${LONG_RANGE}`);
  const rows = table(page, "By day").locator("tbody tr");
  await expect(rows).toHaveCount(100);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(130);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
});

test("Last month changes the URL and Back returns to this month", async ({ page }) => {
  await useFixture("ledger", NOW);
  await page.goto("/ledger");
  const thisMonth = page.getByRole("button", { name: "This month" });
  await expect(thisMonth).toHaveAttribute("aria-pressed", "true");
  const last = page.getByRole("button", { name: "Last month" });
  await expect(last).toBeEnabled();
  await last.click();
  await expect(page).toHaveURL(/\/ledger\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(thisMonth).toHaveAttribute("aria-pressed", "true");
});

test("a range that is not valid in the URL falls back to this month", async ({ page }) => {
  await useFixture("ledger", NOW);
  await page.goto("/ledger?from=2026-11-20&to=2026-11-01");
  await expect(
    page.getByText("The link has a value that is not valid. The page shows this month."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a range with nothing in it shows one sentence in each table", async ({ page }) => {
  await useFixture("ledger", NOW);
  await page.goto(`/ledger?${EMPTY_RANGE}`);
  await expect(page.getByText(EMPTY)).toHaveCount(2);
});

const AXE_PAGES: { name: FixtureName; query: string }[] = [
  { name: "ledger", query: RANGE },
  { name: "ledger-long", query: LONG_RANGE },
  { name: "ledger", query: EMPTY_RANGE },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { name, query } of AXE_PAGES) {
    test(`the page has no WCAG 2.2 AA violations in the ${scheme} theme: ${name} ${query}`, async ({
      page,
    }) => {
      await useFixture(name, NOW);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/ledger?${query}`);
      await expect(page.getByText("Usage data as of")).toBeVisible();
      await expect(page.getByText("Reading the ledger.")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: "By day" })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test("at 375 pixels wide the page has no horizontal page scroll", async ({ page }) => {
  await useFixture("ledger", NOW);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/ledger?${RANGE}`);
  await expect(table(page, "By day")).toBeVisible();
  const overflow: unknown = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(Number(overflow)).toBeLessThanOrEqual(0);
});
