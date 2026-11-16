import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { useFixture } from "./fixtures/use-fixture.ts";
import { HOSTILE_TITLE, type FixtureName } from "./fixtures/sets.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const now = (page: Page) => page.getByRole("region", { name: "Now", exact: true });

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
  await expect(
    lastRun(page)
      .locator(".gantt-seg")
      .getByText(/: running$/),
  ).toHaveCount(3);
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
  const rows: string[] = [];
  for (const row of await buildRows(page).all()) {
    const cells = await row.getByRole("cell").allTextContents();
    rows.push([cells[0], cells[2], cells[5]].join(" "));
  }
  expect(rows).toEqual([
    "1 21 merged",
    "2 22 merge-ready",
    "3 24 stopped at run end",
    "1 23 blocked",
  ]);
  await expect(lastRun(page).getByLabel(/^Issue 30 of/)).toHaveCount(0);
  await expect(
    lastRun(page).getByRole("img", { name: /^Issue 23 of acme\/app: blocked, / }),
  ).toBeVisible();
});

test("a Gantt bar is a link with a tooltip, and a bar with no link is focusable", async ({
  page,
}) => {
  await useFixture("last-run");
  await page.goto("/");
  const bar = lastRun(page).getByRole("link", { name: /^Issue 21 of acme\/app: merged, / });
  await expect(bar).toHaveAttribute("href", "https://github.com/acme/app/issues/21");
  await expect(bar).toHaveAttribute("target", "_blank");
  await expect(bar).toHaveAttribute("rel", "noopener noreferrer");
  await bar.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("acme/app");
  await expect(tooltip).toContainText("#21");
  await expect(tooltip).toContainText(HOSTILE_TITLE);
  await expect(tooltip).toContainText("2 h 0 min");
  await expect(tooltip).toContainText("slot 1");
  await expect(tooltip.locator("img")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const plain = lastRun(page).getByRole("img", { name: /^Issue 23 of acme\/app: blocked, / });
  await plain.focus();
  await expect(page.getByRole("tooltip")).toContainText("not in the Work cache");
  const plainResults = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(plainResults.violations).toEqual([]);
});

test("a Gantt tooltip is not clipped by an ancestor", async ({ page }) => {
  await useFixture("last-run");
  await page.goto("/");
  const bar = lastRun(page).getByRole("link", { name: /^Issue 21 of acme\/app: merged, / });
  await bar.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await tooltip.scrollIntoViewIfNeeded();
  // The hit test skips the part of a box that an ancestor clips, so each corner and the centre must hit the tooltip.
  const hits = await page.evaluate<boolean[]>(`(() => {
    const element = document.querySelector("[role=tooltip]");
    if (element === null) return [];
    const box = element.getBoundingClientRect();
    const points = [
      [box.left + 4, box.top + 4],
      [box.right - 4, box.top + 4],
      [box.left + 4, box.bottom - 4],
      [box.right - 4, box.bottom - 4],
      [box.left + box.width / 2, box.top + box.height / 2],
    ];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && element.contains(hit);
    });
  })()`);
  expect(hits).toEqual([true, true, true, true, true]);
});

test("a Gantt bar is tall enough to read", async ({ page }) => {
  await useFixture("last-run");
  await page.goto("/");
  const bar = lastRun(page).getByRole("link", { name: /^Issue 21 of acme\/app: merged, / });
  const box = await bar.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
});

test("a Gantt bar label that does not fit ends with an ellipsis", async ({ page }) => {
  await useFixture("last-run");
  await page.goto("/");
  const bar = lastRun(page).getByRole("link", { name: /^Issue 21 of acme\/app: merged, / });
  await expect(bar).toHaveCSS("text-overflow", "ellipsis");
});

const SINGLE_LINE_MAX_PX = 24;

test("a Review health bar track has a width and stays in its row", async ({ page }) => {
  await useFixture("review-health");
  await page.goto("/");
  for (const name of ["First-round pass by Risk tier", "Pull requests by highest round"]) {
    const items = review(page).getByRole("list", { name }).getByRole("listitem");
    await expect(items.first()).toBeVisible();
    for (const item of await items.all()) {
      const rowBox = await item.boundingBox();
      const track = await item.locator("[aria-hidden='true']").boundingBox();
      const value = await item.locator("span").last().boundingBox();
      expect(track?.width ?? 0).toBeGreaterThan(40);
      expect(track?.height ?? 0).toBeLessThanOrEqual(12);
      expect(track?.y ?? 0).toBeGreaterThanOrEqual(rowBox?.y ?? 0);
      expect((track?.y ?? 0) + (track?.height ?? 0)).toBeLessThanOrEqual(
        (rowBox?.y ?? 0) + (rowBox?.height ?? 0),
      );
      // "60% of 5" must stay on one line.
      expect(value?.height ?? 0).toBeLessThanOrEqual(SINGLE_LINE_MAX_PX);
      expect(rowBox?.height ?? 0).toBeLessThanOrEqual(SINGLE_LINE_MAX_PX * 2);
    }
  }
});

test("a client scope shows the older run of that client, with its own lanes", async ({ page }) => {
  await useFixture("last-run-clients");
  await page.goto("/?client=acme");
  await expect(lastRun(page)).toContainText("run-synthetic-old");
  const lanes: (string | undefined)[] = [];
  for (const row of await buildRows(page).all()) {
    lanes.push((await row.getByRole("cell").allTextContents())[0]);
  }
  expect(lanes).toEqual(["1", "2"]);
  await page.goto("/");
  await expect(lastRun(page)).toContainText("run-synthetic-new");
});

const review = (page: Page) => page.getByRole("region", { name: "Review health" });

test("Review health shows the pass rates, the rounds, the escalations and the Waivers", async ({
  page,
}) => {
  await useFixture("review-health");
  await page.goto("/");
  await expect(review(page)).toContainText("70% of 10 pull requests");
  const tiers = review(page).getByRole("list", { name: "First-round pass by Risk tier" });
  await expect(tiers.getByRole("listitem")).toHaveText([
    "general83% of 6",
    "sensitive50% of 2",
    "no tier50% of 2",
  ]);
  const rounds = review(page).getByRole("list", { name: "Pull requests by highest round" });
  await expect(rounds.getByRole("listitem")).toHaveText(["Round 18", "Round 21", "Round 31"]);
  await expect(review(page)).toContainText("Escalations: 3");
  await expect(review(page)).toContainText("Waivers in use: 2");
});

test("Review health shows the Factory identity counts of a repo with no Control events", async ({
  page,
}) => {
  await useFixture("review-health");
  await page.goto("/");
  const repos = review(page).getByRole("list", { name: "Repos with no Control events" });
  const tools = repos.getByRole("listitem").filter({ hasText: "bebopaloo/tools" });
  await expect(tools).toContainText("no Control events in 30 days");
  await expect(tools).toContainText("3 factory pull requests reviewed by the Factory identity");
  await expect(tools).toContainText("1 factory pull request with no Factory identity review");
});

test("Review health shows no gate decision when there is no Control event", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/");
  await expect(review(page)).toContainText("First-round pass: no gate decision in 30 days");
});

const tile = (page: Page, label: string) =>
  page.getByRole("list", { name: "Tiles" }).getByRole("listitem").filter({ hasText: label });
const strip = (page: Page) => page.getByRole("region", { name: "The pipeline now" });

test("the tiles show the builds, the merged builds, the waits and the first-round pass", async ({
  page,
}) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  await expect(tile(page, "Builds in the last run")).toContainText("3");
  await expect(tile(page, "Builds in the last run")).toContainText("peak 3 at one time");
  await expect(tile(page, "Merged in the last run")).toContainText("0");
  await expect(tile(page, "First-round pass")).toContainText("no gate decision in 30 days");
});

test("the tile Waits for you counts the items from the Work cache", async ({ page }) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  // 1 BLOCKED, 1 release pull request, 1 merge-ready, 3 TODO with a next step.
  await expect(tile(page, "Waits for you")).toContainText("6");
});

test("the pipeline strip shows each stage with a label and a count", async ({ page }) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  const stages = strip(page).getByRole("list", { name: "Pipeline stages" }).getByRole("listitem");
  await expect(stages).toHaveText([
    "G1Spec2",
    "G2Issues1",
    "queueREADY3",
    "buildIN PROGRESS2",
    "reviewIN REVIEW1",
    "waitsBLOCKED1",
    "mergedDONE5",
    "G3Release2",
  ]);
  await expect(strip(page)).not.toContainText("Data is not complete");
});

test("Now shows the slots in use in the scope All and no slot count in a client scope", async ({
  page,
}) => {
  await useFixture("pipeline");
  await page.goto("/");
  await expect(now(page)).toContainText("4 of 5 build slots in use");
  await page.goto("/?client=acme");
  await expect(now(page)).toContainText("3 builds running");
  await expect(now(page)).not.toContainText("build slots");
});

test("Now shows the builds that wait for the next run between runs", async ({ page }) => {
  await useFixture("pipeline-idle");
  await page.goto("/");
  await expect(now(page)).toContainText("4 builds wait for the next run");
  await expect(now(page)).not.toContainText("build slots");
});

test("the strip says that the data is not complete when a repo is not connected", async ({
  page,
}) => {
  await useFixture("pipeline-incomplete");
  await page.goto("/");
  await expect(strip(page)).toContainText("Data is not complete: 1 repo not connected. See Repos.");
  await expect(strip(page).getByRole("list", { name: "Pipeline stages" })).toBeVisible();
});

test("the strip says that nothing is connected, and the local sections still show", async ({
  page,
}) => {
  await useFixture("not-connected");
  await page.goto("/");
  await expect(strip(page)).toContainText(
    "Not connected. Add the Foreman token to the Keychain, then run pnpm local:up.",
  );
  await expect(strip(page).getByRole("list", { name: "Pipeline stages" })).toHaveCount(0);
  await expect(now(page)).toContainText("No run in progress");
  await expect(tile(page, "Waits for you")).toContainText("not connected");
});

const waitsSection = (page: Page) => page.getByRole("region", { name: "Waits for you" });

test("Waits for you lists the items in the order of factory-next, with reasons and sources", async ({
  page,
}) => {
  await useFixture("waits");
  await page.goto("/?client=acme");
  const items = waitsSection(page).getByRole("list", { name: "Items that wait for you" });
  await expect(items.getByRole("listitem")).toHaveCount(7);
  const rows = await items.getByRole("listitem").allInnerTexts();
  const refs = rows.map((row) => /#\d+/.exec(row)?.[0]);
  expect(refs).toEqual(["#50", "#51", "#60", "#52", "#55", "#53", "#54"]);
  expect(rows[0]).toContain("auto mode refused the migration");
  expect(rows[0]).toContain("source: night log");
  expect(rows[1]).toContain("see the comment in the tracker");
  expect(rows[2]).toContain("Release to perform");
  expect(rows[2]).toContain("source: forge");
  expect(rows[3]).toContain("merge-ready, waits for G3");
  expect(rows[4]).toContain("G2");
  expect(rows[5]).toContain("Spec and G1");
  expect(rows[6]).toContain("make it READY");
  await expect(tile(page, "Waits for you")).toContainText("7");
  await expect(waitsSection(page)).toContainText("run factory-next to act");
  await expect(waitsSection(page)).not.toContainText(/and \d+ more/);
  await expect(items.getByRole("link").first()).toHaveAttribute(
    "href",
    "https://github.com/acme/app/issues/50",
  );
});

test("Waits for you shows a title with HTML and Markdown as text and loads nothing from another host", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) external.push(request.url());
  });
  await useFixture("waits");
  await page.goto("/?client=acme");
  await expect(waitsSection(page).getByText(HOSTILE_TITLE, { exact: true })).toBeVisible();
  await expect(waitsSection(page).locator("img")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("Waits for you says that nothing waits", async ({ page }) => {
  await useFixture("waits-none");
  await page.goto("/");
  await expect(waitsSection(page)).toContainText("Nothing waits for you in this scope.");
});

const AXE_SETS: FixtureName[] = [
  "run-in-progress",
  "stale-lock",
  "no-run",
  "waits",
  "waits-none",
  "pipeline",
  "pipeline-incomplete",
  "review-health",
  "last-run",
  "not-connected",
];

const SCREENS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "375 px", width: 375, height: 800 },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    for (const name of AXE_SETS) {
      test(`the dash has no WCAG 2.2 AA violations in the ${theme} theme at ${screen.name}: ${name}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width: screen.width, height: screen.height });
        await useFixture(name);
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(now(page)).toContainText(/in progress/);
        await expect(page.getByText(/^Reading /)).toHaveCount(0);
        const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
}

test("each result in the timeline and each stage in the strip has a text label", async ({
  page,
}) => {
  await useFixture("last-run");
  await page.goto("/");
  const segments = lastRun(page).locator(".gantt-seg");
  await expect(segments.first()).toBeVisible();
  for (const segment of await segments.all()) {
    await expect(segment).toHaveText(/: (merged|merge-ready|blocked|stopped at run end|running)/);
  }
  const legend = lastRun(page).getByRole("list", { name: "Results" }).getByRole("listitem");
  for (const item of await legend.all()) {
    await expect(item).toHaveText(/\S/);
  }
  await useFixture("pipeline");
  await page.goto("/");
  await expect(strip(page).getByRole("listitem").first()).toBeVisible();
  for (const stage of await strip(page).getByRole("listitem").all()) {
    await expect(stage.locator(".stage-label")).toHaveText(/\S/);
  }
});

const reposSection = (page: Page) => page.getByRole("region", { name: "Repos", exact: true });
const NOT_COMPLETE = "Data is not complete: 1 repo not connected. See Repos.";
const NOT_CONNECTED =
  "Not connected. Add the Foreman token to the Keychain, then run pnpm local:up.";

test("Repos shows each repo with its client and connection state", async ({ page }) => {
  await useFixture("pipeline-incomplete");
  await page.goto("/");
  const table = reposSection(page).getByRole("table");
  const row = (name: string) => table.getByRole("row").filter({ hasText: name });
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(row("acme/app")).toContainText("acme");
  await expect(row("acme/app")).toContainText("connected");
  await expect(row("acme/site")).toContainText("not connected: no token");
  await expect(row("acme/site").getByRole("cell").nth(3)).toHaveText("none");
  await expect(row("misc/notes")).toContainText("no client");
});

test("Repos shows the last night log line and the last Control event of a repo", async ({
  page,
}) => {
  await useFixture("review-health");
  await page.goto("/");
  const site = reposSection(page).getByRole("row").filter({ hasText: "acme/site" });
  await expect(site.getByRole("cell").nth(5)).not.toHaveText("none");
  await expect(site.getByRole("cell").nth(4)).toHaveText("none");
  const tools = reposSection(page).getByRole("row").filter({ hasText: "bebopaloo/tools" });
  await expect(tools.getByRole("cell").nth(5)).toHaveText("none");
});

test("Waits for you and Review health say that the data is not complete", async ({ page }) => {
  await useFixture("pipeline-incomplete");
  await page.goto("/");
  await expect(waitsSection(page)).toContainText(NOT_COMPLETE);
  await expect(review(page)).toContainText(NOT_COMPLETE);
  await expect(strip(page)).toContainText(NOT_COMPLETE);
});

test("with no repo connected, the forge sections say not connected and Review health keeps its local data", async ({
  page,
}) => {
  await useFixture("not-connected");
  await page.goto("/");
  await expect(waitsSection(page)).toContainText(NOT_CONNECTED);
  await expect(strip(page)).toContainText(NOT_CONNECTED);
  await expect(review(page)).toContainText(NOT_CONNECTED);
  await expect(review(page)).toContainText("First-round pass: no gate decision in 30 days");
  await expect(
    reposSection(page).getByRole("row").filter({ hasText: "not connected: no token" }),
  ).toHaveCount(4);
});
