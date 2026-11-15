import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureName } from "./fixtures/sets.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const table = (page: Page) => page.getByRole("table", { name: "Issues and pull requests" });
const bodyRows = (page: Page) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
const rowOf = (page: Page, text: string) => bodyRows(page).filter({ hasText: text });

test("the header nav links Work in the scope and marks it on /work", async ({ page }) => {
  await useFixture("work");
  await page.goto("/?client=acme");
  await expect(page.getByRole("link", { name: "Work" })).toHaveAttribute(
    "href",
    "/work?client=acme",
  );
  await page.getByRole("link", { name: "Work" }).click();
  await expect(page).toHaveURL(/\/work\?client=acme$/);
  await expect(page.getByRole("link", { name: "Work" })).toHaveAttribute("aria-current", "page");
});

test("an issue with its pull request shows the gate, the round and the tier", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme");
  await expect(rowOf(page, "#12")).toBeVisible();
  const cells = await rowOf(page, "#12").getByRole("cell").allTextContents();
  expect(cells.slice(0, 11)).toEqual([
    "acme/app",
    "#12",
    "Add the export",
    "IN REVIEW",
    "feature",
    "high",
    "#40",
    "success",
    "pass",
    "2",
    "sensitive",
  ]);
  await expect(
    page.getByRole("link", { name: "Issue 12 of acme/app in the tracker" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Pull request 40 of acme/app in the forge" }),
  ).toBeVisible();
});

test("an issue with no pull request and a pull request with no issue", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme");
  await expect(rowOf(page, "#15")).toBeVisible();
  const issue = await rowOf(page, "#15").getByRole("cell").allTextContents();
  expect(issue.slice(6, 11)).toEqual(["—", "—", "—", "—", "—"]);
  const loose = rowOf(page, "Release 1.2");
  await expect(loose).toContainText("no issue");
  await expect(loose.getByRole("link")).toHaveCount(1);
  await expect(loose.getByRole("link", { name: /in the forge/ })).toBeVisible();
});

test("a stale closed issue shows its marker and TODO closed", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme");
  const row = rowOf(page, "Remove the old flag");
  await expect(row).toContainText("not in the last fetch");
  await expect(row).toContainText("TODO · closed");
});

test("a title of markup shows as plain text and the null link shows no Issue link", async ({
  page,
}) => {
  await useFixture("work");
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.example")) external.push(request.url());
  });
  await page.goto("/work?client=acme");
  const row = rowOf(page, "evil.example");
  await expect(row).toContainText(
    '<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)',
  );
  await expect(row.locator("img, strong, a")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("the state filter shows counts, filters and keeps the value in the URL", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme");
  await expect(page.getByRole("button", { name: "All 6" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "BLOCKED 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No issue 1" })).toBeVisible();
  await page.getByRole("button", { name: "BLOCKED 1" }).click();
  await expect(page).toHaveURL(/issue_state=BLOCKED/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page)).toContainText("Update the footer");
});

test("the repo filter lists only the repos of the scope", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme");
  await expect(bodyRows(page).first()).toBeVisible();
  await expect(page.getByLabel("Repo", { exact: true }).locator("option")).toHaveText([
    "All repos",
    "acme/app",
    "acme/site",
  ]);
});

test("a repo that is not connected shows the notes, and a repo with no events too", async ({
  page,
}) => {
  await useFixture("work");
  await page.goto("/work");
  await expect(page.getByText("Data is not complete: 1 repo not connected.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Repos" })).toHaveAttribute("href", "/#dash-repos");
  await expect(
    page.getByText(
      "No Control events in 30 days for bebopaloo/tools. Round and the event Machine gate show —.",
    ),
  ).toBeVisible();
});

test("a value that is not valid shows the message and no table", async ({ page }) => {
  await useFixture("work");
  await page.goto("/work?client=acme&issue_state=DOING");
  await expect(page.getByText("This link has a filter value that is not valid.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Show all work" })).toHaveAttribute(
    "href",
    "/work?client=acme",
  );
  await expect(table(page)).toHaveCount(0);
});

test("not connected shows the text and no table", async ({ page }) => {
  await useFixture("not-connected");
  await page.goto("/work");
  await expect(
    page.getByText(/Not connected\. Add the Foreman token to the Keychain/),
  ).toBeVisible();
  await expect(table(page)).toHaveCount(0);
});

test("Show more adds the pages and moves the focus to the first new row", async ({ page }) => {
  await useFixture("work-many");
  await page.goto("/work");
  await expect(bodyRows(page)).toHaveCount(100);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(bodyRows(page)).toHaveCount(200);
  await expect(bodyRows(page).nth(100)).toBeFocused();
  await expect(page.getByText("100 more rows shown")).toBeAttached();
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(bodyRows(page)).toHaveCount(230);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
});

test("the table asks again each 60 seconds while the tab is visible", async ({ page }) => {
  await useFixture("work");
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/work/items**", async (route) => {
    requests += 1;
    await route.continue();
  });
  await page.goto("/work");
  await expect(bodyRows(page).first()).toBeVisible();
  const before = requests;
  await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBe(before + 1);
});

test("the page does not scroll sideways at 375 px, and the table region does", async ({ page }) => {
  await useFixture("work");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/work");
  await expect(bodyRows(page).first()).toBeVisible();
  const overflow = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const region = page.getByRole("region", { name: "Issues and pull requests table" });
  const scrolls = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrolls).toBe(true);
});

const AXE_CASES: { name: FixtureName; path: string }[] = [
  { name: "work", path: "/work" },
  { name: "work", path: "/work?client=acme&issue_state=BLOCKED" },
  { name: "work", path: "/work?issue_state=DOING" },
  { name: "work-many", path: "/work" },
  { name: "not-connected", path: "/work" },
];

for (const theme of ["light", "dark"] as const) {
  for (const { name, path } of AXE_CASES) {
    test(`/work has no WCAG 2.2 AA violations in the ${theme} theme: ${name} ${path}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await useFixture(name);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Reading the work items.")).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test("a narrow screen has no WCAG 2.2 AA violation", async ({ page }) => {
  await useFixture("work");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/work");
  await expect(bodyRows(page).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
});
