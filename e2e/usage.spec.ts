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

test("the limit tiles and the Limit history show the readings of the capture file", async ({
  page,
}) => {
  await useFixture("usage");
  await page.goto("/usage");
  const five = tile(page, "5-hour window");
  await expect(five).toContainText("62%");
  await expect(five).toContainText("under 70%");
  await expect(five).toContainText(/resets /);
  await expect(five).toContainText("latest reading");
  await expect(five).toContainText("Plan-wide: all clients and Projects");
  await expect(tile(page, "7-day window")).toContainText("48%");
  const history = tile(page, "Limit history");
  await expect(history.getByRole("table", { name: "5-hour windows" })).toBeAttached();
  await expect(chartRows(page, "5-hour windows")).toHaveCount(2);
  await expect(chartRows(page, "5-hour windows").last()).toContainText("in progress");
  await expect(chartRows(page, "5-hour windows").first()).toContainText("90% or more");
  await expect(history).toContainText("1 of the last 2 5-hour windows reached 90% or more");
  await expect(history).toContainText("0 of the last 2 7-day windows reached 90% or more");
  await expect(chartRows(page, "7-day windows").first()).toContainText("70% or more");
});

test("the activity calendar, Cache efficiency and Month outlook show the usage", async ({
  page,
}) => {
  await useFixture("usage");
  await page.goto("/usage");
  const calendar = tile(page, "Activity calendar");
  await expect(calendar).toContainText("This panel ignores the date range.");
  const grid = calendar.getByRole("table", { name: "Tokens per day in the last 26 weeks" });
  await expect(grid.getByRole("columnheader")).toHaveCount(26);
  await expect(
    grid.getByRole("img", { name: /^\d+ \w+ 20\d\d: [\d.]+[KM]? tokens$/ }).first(),
  ).toBeAttached();
  await expect(calendar.locator(".level-4").first()).toBeAttached();
  await expect(calendar.getByText("up to 25%")).toBeVisible();
  const cache = tile(page, "Cache efficiency");
  await expect(cache).toContainText("Cache hit ratio 72%");
  await expect(cache).toContainText("input tokens came from the cache");
  const outlook = tile(page, "Month outlook");
  await expect(outlook).toContainText("The projection takes the average per day so far this month");
  await expect(outlook).toContainText(/so far this month|No usage so far this month/);
});

test("without a limit reading each limit tile and chart shows No reading", async ({ page }) => {
  await useFixture("usage-empty");
  await page.goto("/usage");
  await expect(tile(page, "5-hour window")).toContainText("No reading");
  await expect(tile(page, "7-day window")).toContainText("No reading");
  await expect(tile(page, "Limit history").getByText("No reading")).toHaveCount(2);
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
  await expect(page.getByRole("region", { name: "Limit history" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "5-hour window" })).toHaveCount(0);
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
  await expect(page.getByText("No usage in this range in this scope.")).toHaveCount(4);
  await expect(tile(page, "5-hour window")).toContainText("No reading");
  await expect(tile(page, "Activity calendar")).toContainText(
    "No usage in the last 26 weeks in this scope.",
  );
  await expect(tile(page, "Month outlook")).toContainText(
    "No usage so far this month in this scope.",
  );
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

const noSidewaysScroll = async (page: Page): Promise<void> => {
  const overflow: unknown = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toEqual(expect.any(Number));
  expect(Number(overflow)).toBeLessThanOrEqual(0);
};

const openFirstProject = async (page: Page): Promise<void> => {
  await page.getByRole("table", { name: "Usage by Project" }).getByRole("link").first().click();
  await expect(page.getByRole("table", { name: "Usage by Model" })).toBeVisible();
  await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
};

const VIEW_STATES: { name: string; fixture: FixtureName; open: (page: Page) => Promise<void> }[] = [
  {
    name: "the default page",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage");
      await expect(tile(page, "Tokens, last 14 days")).toContainText("11.4M");
      await expect(tile(page, "Month outlook")).toBeVisible();
    },
  },
  {
    name: "a client scope",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage?client=acme");
      await expect(tile(page, "Tokens, last 14 days")).toContainText("8M");
    },
  },
  {
    name: "no usage",
    fixture: "usage-empty",
    open: async (page) => {
      await page.goto("/usage");
      await expect(page.getByText("No usage in this range in this scope.")).toHaveCount(4);
    },
  },
  {
    name: "the Project page",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage");
      await openFirstProject(page);
    },
  },
  {
    name: "the Turns metric with the Session tab",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage?metric=turns&tab=session");
      await expect(page.getByRole("table", { name: "Turns by day" })).toBeAttached();
    },
  },
  {
    name: "a range of 30 days",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage?range=30d");
      await expect(tile(page, "Tokens, last 30 days")).toContainText("11.5M");
    },
  },
  {
    name: "a link that is not valid",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage?range=0d");
      await expect(page.getByText("The link has a value that is not valid.")).toBeVisible();
    },
  },
  {
    name: "a Project outside the scope",
    fixture: "usage",
    open: async (page) => {
      await page.goto("/usage/projects/ffffffffffff?client=acme");
      await expect(page.getByText("No such Project in this scope.")).toBeVisible();
    },
  },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { name, fixture, open } of VIEW_STATES) {
    test(`at 375 pixels wide ${name} has no horizontal page scroll in the ${scheme} theme`, async ({
      page,
    }) => {
      await useFixture(fixture);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 800 });
      await open(page);
      await noSidewaysScroll(page);
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  for (const { name, fixture, open } of VIEW_STATES.slice(4)) {
    test(`${name} has no WCAG 2.2 AA violations in the ${scheme} theme`, async ({ page }) => {
      await useFixture(fixture);
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
