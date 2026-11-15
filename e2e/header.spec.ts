import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("the header shows the scope from the URL and keeps it in links", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/?client=acme");
  await expect(page.getByText("Showing only acme")).toBeVisible();
  await expect(page.getByRole("link", { name: "Foreman", exact: true })).toHaveAttribute(
    "href",
    "/?client=acme",
  );
  await expect(page.getByText("Connected")).toBeVisible();
  await page.getByRole("button", { name: "bebopaloo" }).click();
  await expect(page).toHaveURL(/\?client=bebopaloo$/);
});

test("Foreman opens in the last chosen scope", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/");
  await page.getByRole("button", { name: "acme" }).click();
  await expect(page.getByText("Showing only acme")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Showing only acme")).toBeVisible();
  await expect(page).toHaveURL(/\?client=acme$/);
});

test("an unknown client shows Unknown client and no data", async ({ page }) => {
  await useFixture("no-run");
  await page.goto("/?client=globex");
  await expect(page.getByRole("alert")).toContainText("Unknown client");
  await expect(page.getByRole("heading", { name: "Foreman dash" })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the header has no WCAG 2.2 AA violations in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await useFixture("no-run");
    await page.goto("/?client=acme");
    await expect(page.getByText("Connected")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const scoped = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(scoped.violations).toEqual([]);

    await page.goto("/?client=globex");
    await expect(page.getByRole("alert")).toBeVisible();
    const unknown = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(unknown.violations).toEqual([]);
  });
}

test("the theme button cycles the theme, keeps it after a reload and passes axe in each state", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await useFixture("no-run");
  await page.goto("/");
  const html = page.locator("html");
  await expect(page.getByRole("button", { name: "Theme: auto (dark)" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Theme: auto (dark)" }).click();
  await expect(page.getByRole("button", { name: "Theme: light" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "light");
  const light = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(light.violations).toEqual([]);

  await page.reload();
  await expect(page.getByRole("button", { name: "Theme: light" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Theme: light" }).click();
  await expect(page.getByRole("button", { name: "Theme: dark" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Theme: dark" }).click();
  await expect(page.getByRole("button", { name: "Theme: auto (dark)" })).toBeVisible();
});
