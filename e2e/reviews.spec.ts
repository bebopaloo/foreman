import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureName } from "./fixtures/sets.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const tiles = (page: Page) => page.getByRole("list", { name: "Tiles" });
const tile = (page: Page, name: string) =>
  tiles(page).getByRole("listitem").filter({ hasText: name });
const pullRequests = (page: Page) => page.getByRole("list", { name: "Pull requests" });
const prRow = (page: Page, text: string) =>
  pullRequests(page).getByRole("listitem").filter({ hasText: text });
const securityTable = (page: Page) =>
  page.getByRole("table", { name: "Security findings by severity and Risk tier" });
const cellsOf = (page: Page, severity: string) =>
  securityTable(page)
    .getByRole("row", { name: new RegExp(`^${severity}`) })
    .getByRole("cell");

test("the nav links Reviews in the scope and marks it", async ({ page }) => {
  await useFixture("reviews-incomplete");
  await page.goto("/?client=acme");
  await expect(page.getByRole("link", { name: "Reviews" })).toHaveAttribute(
    "href",
    "/reviews?client=acme",
  );
  await page.getByRole("link", { name: "Reviews" }).click();
  await expect(page).toHaveURL(/\/reviews\?client=acme$/);
  await expect(page.getByRole("link", { name: "Reviews" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Reviews", level: 1 })).toBeVisible();
});

test("the tiles and the four sections show in order", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  await expect(tile(page, "Pull requests reviewed")).toContainText("5");
  await expect(tile(page, "First-round pass")).toContainText("40%");
  await expect(tile(page, "First-round pass")).toContainText("of 5 pull requests");
  await expect(tile(page, "Escalation rate")).toContainText("20%");
  await expect(tile(page, "Escalation rate")).toContainText("of 5 pull requests with a tier");
  await expect(tile(page, "Review share of total time")).toContainText("61%");
  await expect(tile(page, "Review share of total time")).toContainText("of 1 build");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Risk tier results",
    "Rounds to settle, by final tier",
    "Security findings",
    "Review time against build time",
  ]);
});

test("no gate decision shows the dash tiles and the empty sections", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/reviews");
  await expect(tile(page, "Pull requests reviewed")).toContainText("0");
  await expect(tile(page, "First-round pass")).toContainText("no gate decision in 30 days");
  await expect(tile(page, "Escalation rate")).toContainText("no tier in 30 days");
  await expect(page.getByText("No Control events in this scope.")).toHaveCount(3);
});

test("the path tier against final tier table shows the escalated cell", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  const table = page.getByRole("table", { name: "Path tier against final tier" });
  await expect(
    table
      .getByRole("row", { name: /^general/ })
      .getByRole("cell")
      .first(),
  ).toHaveText("1escalated");
  await expect(
    table
      .getByRole("row", { name: /^sensitive/ })
      .getByRole("cell")
      .nth(1),
  ).toHaveText("2");
  await expect(
    page.getByRole("list", { name: "Merges by base and tier" }).getByRole("listitem"),
  ).toHaveText(["main: general 1", "feature/*: authority 1"]);
});

test("the rounds to settle of a tier show as text", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  const rounds = page.getByRole("list", { name: "Rounds to settle by final tier" });
  await expect(rounds).toContainText(
    "sensitive · 2 pull requestsround 1: 1 · round 2: 0 · round 3: 0 · BLOCKED: 1 · not settled: 0last-gate pass: 50% of 2",
  );
});

test("the mode buttons switch the Security findings and set mode in the URL", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  await expect(cellsOf(page, "major")).toHaveText(["1", "0", "0", "1", "2"]);
  await expect(page.getByText("1 pull request with no matrix: not counted")).toBeVisible();
  await page.getByRole("button", { name: "Left at settle" }).click();
  await expect(page).toHaveURL(/\/reviews\?mode=settle$/);
  await expect(page.getByRole("button", { name: "Left at settle" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cellsOf(page, "major")).toHaveText(["0", "0", "0", "1", "1"]);
  await expect(cellsOf(page, "minor")).toHaveText(["1", "0", "1", "0", "2"]);
  await page.getByRole("button", { name: "Found in round 1" }).click();
  await expect(page).toHaveURL(/\/reviews$/);
});

test("refs stay plain text and the browser makes no request to the host in a ref", async ({
  page,
}) => {
  const hosts: string[] = [];
  page.on("request", (request) => {
    hosts.push(new URL(request.url()).hostname);
  });
  await useFixture("reviews");
  await page.goto("/reviews");
  const refs = page.getByRole("list", { name: "Most frequent refs" });
  await expect(refs).toContainText('<img src="https://evil.example/t.png">');
  await expect(refs.getByRole("listitem").first()).toContainText("CWE-639");
  await expect(refs.getByRole("listitem").first()).toContainText("2 pull requests");
  await expect(page.locator("main img")).toHaveCount(0);
  expect(hosts).not.toContain("evil.example");
});

test("the signal list links only a pull request that the cache has", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  const signals = page.getByRole("list", { name: "Signals" });
  const general = signals.getByRole("listitem").filter({ hasText: "#46" });
  await expect(general).toContainText("general · 1 minor Security finding");
  await expect(general.getByRole("link")).toHaveAttribute(
    "href",
    "https://github.com/acme/app/pull/46",
  );
  await expect(general.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  const inert = signals.getByRole("listitem").filter({ hasText: "#50" });
  await expect(inert).toContainText("inert · 1 major Security finding");
  await expect(inert.getByRole("link")).toHaveCount(0);
});

test("the time rows show the build end source and the split", async ({ page }) => {
  await useFixture("reviews");
  await page.goto("/reviews");
  await expect(pullRequests(page).getByRole("listitem")).toHaveCount(3);
  const agent = prRow(page, "#40");
  await expect(agent).toContainText("authority · escalated from general · 2 rounds, passed");
  await expect(agent).toContainText("build 35 min");
  await expect(agent).toContainText("review agents");
  await expect(agent).toContainText("resolver");
  await expect(agent).toContainText("build end: agent span");
  await expect(agent.getByRole("link")).toHaveAttribute(
    "href",
    "https://github.com/acme/app/pull/40",
  );
  const gateEvent = prRow(page, "#41");
  await expect(gateEvent).toContainText("build end: first gate event");
  await expect(prRow(page, "#42")).toContainText("3 rounds, BLOCKED");
  await expect(
    page.getByRole("table", { name: "Review time against build time, by final tier" }),
  ).toBeVisible();
});

test("a repo with Control events off shows the note and its build with no tier", async ({
  page,
}) => {
  await useFixture("reviews-events-off");
  await page.goto("/reviews");
  const off = page.getByRole("list", { name: "Repos with no Control events" });
  await expect(off).toContainText(
    "Control events are off in acme/site. Its pull requests show only in Review time against build time, from the night log and the Usage index.",
  );
  const row = prRow(page, "acme/site #5");
  await expect(row).toContainText("no tier · rounds unknown");
  await expect(row).toContainText("no build end");
});

test("some repos not connected shows Data is not complete and no link for its rows", async ({
  page,
}) => {
  await useFixture("reviews-incomplete");
  await page.goto("/reviews");
  await expect(page.getByText("Data is not complete: 1 repo not connected.")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Repos" }).first()).toHaveAttribute(
    "href",
    "/#dash-repos",
  );
  await expect(tile(page, "Pull requests reviewed")).toContainText("5");
});

test("not connected shows the text and keeps the numbers, with no link", async ({ page }) => {
  await useFixture("reviews-not-connected");
  await page.goto("/reviews");
  await expect(page.getByText(/Not connected\. Add the Foreman token to the Keychain/)).toHaveCount(
    2,
  );
  await expect(tile(page, "Pull requests reviewed")).toContainText("5");
  await expect(prRow(page, "#40")).toBeVisible();
  await expect(pullRequests(page).getByRole("link")).toHaveCount(0);
});

test("a client scope asks only for the data of the client", async ({ page, request }) => {
  await useFixture("reviews");
  await page.goto("/reviews?client=bebopaloo");
  await expect(tile(page, "Pull requests reviewed")).toContainText("0");
  const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? ""}`;
  const unknown = await request.get(
    `${api}/api/reviews/pull-requests?client=acme&repo=ffffffffffff`,
  );
  expect(unknown.status()).toBe(400);
});

test("the page asks again each 60 seconds while the tab is visible", async ({ page }) => {
  await useFixture("reviews");
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/reviews?**", async (route) => {
    requests += 1;
    await route.continue();
  });
  await page.goto("/reviews");
  await expect(tile(page, "Pull requests reviewed")).toContainText("5");
  const before = requests;
  await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBe(before + 1);
});

test("the page does not scroll sideways at 375 px", async ({ page }) => {
  await useFixture("reviews");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/reviews");
  await expect(prRow(page, "#40")).toBeVisible();
  const overflow = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

const AXE_SETS: FixtureName[] = [
  "reviews",
  "no-run",
  "reviews-events-off",
  "reviews-incomplete",
  "reviews-not-connected",
];

async function scan(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Reading the reviews.")).toHaveCount(0);
  await expect(page.getByText("Reading the pull requests.")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  for (const name of AXE_SETS) {
    test(`/reviews has no WCAG 2.2 AA violations in the ${theme} theme: ${name}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await useFixture(name);
      await page.goto("/reviews");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await scan(page);
    });
  }
}

test("a narrow screen has no WCAG 2.2 AA violation", async ({ page }) => {
  await useFixture("reviews");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/reviews");
  await expect(prRow(page, "#40")).toBeVisible();
  await scan(page);
});

test("the settle mode has no WCAG 2.2 AA violation in the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await useFixture("reviews");
  await page.goto("/reviews?mode=settle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page);
});
