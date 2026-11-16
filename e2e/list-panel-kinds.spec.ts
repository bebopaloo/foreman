import { appendFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { LIVE_CLAUDE_DIR, useFixture } from "./fixtures/use-fixture.ts";
import { nightLogFiles, PANEL_HOSTILE_TITLE, runTwoLines } from "./fixtures/list-panel-files.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const panel = (page: Page) => page.getByRole("complementary");
const rows = (page: Page) => panel(page).getByRole("listitem");
const heading = (page: Page, name: string) => panel(page).getByRole("heading", { name });

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
}

/** The text of each row, with the white space of the lines made single. */
async function rowTexts(list: Locator): Promise<string[]> {
  const texts = await list.allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, " ").trim());
}

const TIME = String.raw`\d\d:\d\d`;

test("the Builds panel shows each build in order, with a row for a repo that is not in the Work cache", async ({
  page,
}) => {
  await useFixture("list-panel");
  await page.goto("/");
  const tile = page.getByRole("button", { name: /Builds in the last run/ });
  await expect(tile).toContainText("6");
  await tile.click();
  await expect(heading(page, "Builds in the last run")).toBeFocused();
  await expect(panel(page)).toContainText("6 items");
  await expect(tile).toHaveAttribute("aria-expanded", "true");
  expect(page.url()).toContain("panel=builds");
  await expect(rows(page)).toHaveCount(6);

  await expect(rows(page)).not.toHaveCount(0);
  const texts = await rowTexts(rows(page));
  const order = [
    // A, then scratch, B, D, E and C: by start.
    new RegExp(`^acme/app #21 .* merged · ${TIME} to ${TIME} · 2 h 0 min$`),
    new RegExp(`^scratch #7 not in the Work cache blocked · ${TIME} to ${TIME} · 0 h 25 min$`),
    new RegExp(`^acme/app #22 Sort the invoices merge-ready · ${TIME} to ${TIME} · 2 h 50 min$`),
    new RegExp(
      `^acme/app #24 Fix the footer stopped at run end · ${TIME} to ${TIME} · 3 h 40 min$`,
    ),
    new RegExp(`^acme/app #25 Reject a transfer merged · ${TIME} to ${TIME} · 0 h 30 min$`),
    new RegExp(`^acme/app #23 Archive the invoices blocked · ${TIME} to ${TIME} · 1 h 30 min$`),
  ];
  expect(texts).toHaveLength(order.length);
  order.forEach((pattern, index) => {
    expect(texts[index]).toMatch(pattern);
  });

  const first = rows(page).first();
  await expect(first.getByRole("link", { name: "#21" })).toHaveAttribute(
    "href",
    "https://github.com/acme/app/issues/21",
  );
  await expect(first).toContainText(PANEL_HOSTILE_TITLE);
  await expect(panel(page).locator("img")).toHaveCount(0);

  const scratch = rows(page).nth(1);
  await expect(scratch.getByRole("link")).toHaveCount(0);
  await expectNoViolations(page);
});

test("the Merged panel shows the merged builds by end time", async ({ page }) => {
  await useFixture("list-panel");
  await page.goto("/");
  await page.getByRole("button", { name: /Merged in the last run/ }).click();
  await expect(heading(page, "Merged in the last run")).toBeFocused();
  await expect(panel(page)).toContainText("2 items");
  expect(page.url()).toContain("panel=merged");
  await expect(rows(page)).not.toHaveCount(0);
  const texts = await rowTexts(rows(page));
  expect(texts).toHaveLength(2);
  expect(texts[0]).toMatch(/^acme\/app #25 Reject a transfer merged · /);
  expect(texts[1]).toMatch(/^acme\/app #21 .* merged · /);
  await expectNoViolations(page);
});

test("a Risk tier row opens the pull requests of that tier, and a counted pull request with no cache row has a plain row", async ({
  page,
}) => {
  await useFixture("list-panel");
  await page.goto("/");
  const tier = page.getByRole("button", { name: /^general/ });
  await tier.click();
  await expect(heading(page, "First-round pass: general")).toBeFocused();
  await expect(panel(page)).toContainText("3 items");
  expect(page.url()).toContain("panel=tier_general");
  await expect(tier).toHaveAttribute("aria-expanded", "true");

  await expect(rows(page)).not.toHaveCount(0);
  const texts = await rowTexts(rows(page));
  expect(texts).toEqual([
    "acme/app PR #41 Change the sort order PR #41 · pass",
    "acme/app #14 Add the export PR #40 · fail",
    "acme/app PR #12 not in the Work cache PR #12 · pass",
  ]);

  // The row of the closed pull request 40 links to it, not to the open pull request 44.
  await expect(rows(page).nth(1).getByRole("link", { name: "PR #40" })).toHaveAttribute(
    "href",
    "https://github.com/acme/app/pull/40",
  );

  const plain = rows(page).nth(2);
  await expect(plain.getByText("not in the Work cache")).toBeVisible();
  await expect(plain.getByRole("link")).toHaveCount(0);
  await expectNoViolations(page);
});

test("a round row opens the pull requests with that highest round", async ({ page }) => {
  await useFixture("list-panel");
  await page.goto("/");
  await page.getByRole("button", { name: /^Round 2/ }).click();
  await expect(heading(page, "Round 2")).toBeFocused();
  await expect(panel(page)).toContainText("1 item");
  expect(page.url()).toContain("panel=round_2");
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual(["acme/app #14 Add the export PR #40 · round 2"]);
  await expectNoViolations(page);

  await page.getByRole("button", { name: /^Round 1/ }).click();
  await expect(heading(page, "Round 1")).toBeVisible();
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual([
      "acme/app PR #41 Change the sort order PR #41 · round 1",
      "acme/app PR #12 not in the Work cache PR #12 · round 1",
    ]);

  await page.getByRole("button", { name: /^Round 3/ }).click();
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual(["acme/app PR #42 not in the Work cache PR #42 · round 3"]);
  await expectNoViolations(page);
});

test("Escalations lists the pull requests with the tier changes, oldest first", async ({
  page,
}) => {
  await useFixture("list-panel");
  await page.goto("/");
  await page.getByRole("button", { name: "Escalations: 3" }).click();
  await expect(heading(page, "3 Escalations on 2 pull requests")).toBeFocused();
  expect(page.url()).toContain("panel=escalated");
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual([
      "acme/app PR #41 Change the sort order PR #41 · general → sensitive",
      "acme/app #14 Add the export PR #40 · general → sensitive, sensitive → authority",
    ]);
  await expectNoViolations(page);
});

test("Waivers in use lists the pull requests with the Waiver IDs", async ({ page }) => {
  await useFixture("list-panel");
  await page.goto("/");
  await page.getByRole("button", { name: "Waivers in use: 2" }).click();
  await expect(heading(page, "2 Waivers on 3 pull requests")).toBeFocused();
  expect(page.url()).toContain("panel=waivers");
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual([
      "acme/app PR #5 not in the Work cache PR #5 · W-1",
      "acme/app PR #4 not in the Work cache PR #4 · W-1",
      "acme/site PR #9 not in the Work cache PR #9 · W-1",
    ]);
  await expectNoViolations(page);
});

test("a change of the client scope keeps the panel and shows its rows in the new scope", async ({
  page,
}) => {
  await useFixture("list-panel");
  await page.goto("/?client=acme&panel=stage_blocked");
  await expect(heading(page, "BLOCKED")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  const first = await rowTexts(rows(page));
  expect(first).toHaveLength(2);
  expect(first.every((text) => text.startsWith("acme/app #"))).toBe(true);

  await page.getByRole("button", { name: "bebopaloo", exact: true }).click();
  await expect(page.getByRole("button", { name: "bebopaloo", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows(page)).toHaveCount(1);
  await expect
    .poll(() => rowTexts(rows(page)))
    .toEqual(["bebopaloo/tools #61 Write the guide BLOCKED · medium"]);
  expect(page.url()).toContain("panel=stage_blocked");
  expect(page.url()).toContain("client=bebopaloo");
  await expectNoViolations(page);
});

test("the Builds panel follows the run of the dash when the dash moves to a newer run", async ({
  page,
}) => {
  await useFixture("list-panel");
  await page.clock.install();
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/work/items") asked.push(url.searchParams.get("run") ?? "");
  });
  await page.goto("/?panel=builds");
  await expect(panel(page)).toContainText("6 items");
  expect(asked).toContain("run-panel-1");
  expect(asked).not.toContain("run-panel-2");

  // A new run writes its first lines. The panel keeps run 1 until the dash response shows run 2.
  const now = new Date();
  for (const [file, text] of Object.entries(nightLogFiles(runTwoLines(now)))) {
    await appendFile(path.join(LIVE_CLAUDE_DIR, file), text);
  }
  await page.clock.fastForward(60_000);

  await expect(panel(page)).toContainText("1 item");
  await expect.poll(() => asked.includes("run-panel-2")).toBe(true);
  await expect.poll(() => rowTexts(rows(page))).toHaveLength(1);
  expect((await rowTexts(rows(page)))[0]).toMatch(/^acme\/app #26 Plan the search merged · /);
  await expectNoViolations(page);
});
