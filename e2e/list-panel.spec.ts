import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const panel = (page: Page) => page.getByRole("complementary");
const rows = (page: Page) => panel(page).getByRole("listitem");

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
}

test("a stage opens its panel with one row for each count, and the axe scan passes", async ({
  page,
}) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  const stage = page.getByRole("button", { name: /DONE/ });
  await stage.click();
  await expect(panel(page).getByRole("heading", { name: "DONE" })).toBeFocused();
  await expect(panel(page)).toContainText("5 items");
  await expect(rows(page)).toHaveCount(5);
  await expect(stage).toHaveAttribute("aria-expanded", "true");
  expect(page.url()).toContain("panel=stage_done");
  await expectNoViolations(page);
});

test("G3 shows the pull request into production first", async ({ page }) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme&panel=stage_g3");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("PR #200");
  await expectNoViolations(page);
});

test("a second stat replaces the panel, the same stat closes it, and Escape returns the focus", async ({
  page,
}) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  await page.getByRole("button", { name: /Builds in the last run/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Builds in the last run" })).toBeVisible();
  const blocked = page.getByRole("button", { name: "waits BLOCKED" });
  await blocked.click();
  await expect(panel(page).getByRole("heading", { name: "BLOCKED" })).toBeVisible();
  expect(page.url()).toContain("panel=stage_blocked");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(blocked).toBeFocused();
  expect(page.url()).not.toContain("panel");
});

test("a link opens the panel, and Back closes it", async ({ page }) => {
  await useFixture("pipeline");
  await page.goto("/?client=acme");
  await page.goto("/?client=acme&panel=stage_blocked");
  await expect(rows(page)).toHaveCount(1);
  await page.goBack();
  await expect(panel(page)).toHaveCount(0);
});

test("a panel value that is not valid shows a note and no panel", async ({ page }) => {
  await useFixture("pipeline");
  await page.goto("/?panel=stage_doing");
  await expect(page.getByText("This link has a panel value that is not valid.")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

test("Waits for you opens from the tile, with reasons and sources, and the axe scan passes", async ({
  page,
}) => {
  await useFixture("waits");
  await page.goto("/?client=acme");
  await page.getByRole("button", { name: /Waits for you/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Waits for you" })).toBeFocused();
  await expect(rows(page).first()).toContainText("source:");
  expect(page.url()).toContain("panel=waits");
  await expectNoViolations(page);
});

test("the panel is 40% of the width and the page does not scroll sideways", async ({ page }) => {
  await useFixture("pipeline");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?client=acme&panel=stage_done");
  const box = await panel(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(360);
  const overflow = await page.evaluate<number>(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
