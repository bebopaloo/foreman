import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("Foreman opens at the Foreman dash with its sections in order", async ({ page }) => {
  await useFixture("empty");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Foreman dash" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Now",
    "Waits for you",
    "Last run",
    "Review health",
    "Repos",
  ]);
  await expect(page.getByRole("link", { name: "Foreman dash" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("contentinfo")).toContainText("Foreman ");
});

test("the home page has no WCAG 2.2 AA violations", async ({ page }) => {
  await useFixture("empty");
  await page.goto("/");
  await expect(page.getByText("No run in progress")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
});
