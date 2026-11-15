import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { sessionsDay } from "./fixtures/session-transcripts.ts";
import { useFixture } from "./fixtures/use-fixture.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.use({ timezoneId: "UTC" });

const NOW = new Date();
const DAY = sessionsDay(NOW);
const SESSIONS = `/sessions?day=${DAY}`;

const sessionLinks = (page: Page) =>
  page.getByRole("list", { name: "Sessions of the day" }).getByRole("link");
const spanRows = (page: Page) =>
  page.getByRole("list", { name: "Spans of the session" }).getByRole("listitem");

test("the nav links to Sessions and the page lists the sessions of the day, newest start first", async ({
  page,
}) => {
  await useFixture("sessions", NOW);
  await page.goto(SESSIONS);
  await expect(page.getByRole("link", { name: "Sessions", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sessionLinks(page)).toHaveCount(3);
  await expect(sessionLinks(page).nth(0)).toContainText("No skill");
  await expect(sessionLinks(page).nth(0)).toContainText("Session");
  await expect(sessionLinks(page).nth(1)).toContainText("factory-core:factory-next");
  await expect(sessionLinks(page).nth(1)).toContainText("Attended loop");
  await expect(sessionLinks(page).nth(2)).toContainText("factory-core:factory-run");
  await expect(sessionLinks(page).nth(2)).toContainText("Unattended loop");
  await expect(sessionLinks(page).nth(2)).toContainText("2 messages from you");
  await expect(sessionLinks(page).nth(0)).toContainText("1 message from you");
  await expect(sessionLinks(page).nth(0)).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Usage data as of")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Sessions on \d+ \w+ \d{4}$/);
});

test("the night run shows its spans, the You lane and the table for screen readers", async ({
  page,
}) => {
  await useFixture("sessions", NOW);
  await page.goto(`${SESSIONS}&session=sess-night-1`);
  await expect(spanRows(page).filter({ hasText: "software-developer" })).toHaveCount(2);
  await expect(spanRows(page).filter({ hasText: "review-finder" })).toHaveCount(2);
  await expect(spanRows(page).filter({ hasText: "sub-agent (unknown)" })).toHaveCount(1);
  await expect(spanRows(page).filter({ hasText: "acme/app #11" })).not.toHaveCount(0);
  await expect(page.locator(".you-mark")).toHaveCount(2);
  await expect(page.getByText("Metadata only.")).toBeVisible();
  await expect(
    page.getByText("Not connected. Add the Foreman token to the Keychain"),
  ).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount((await spanRows(page).count()) + 1);
  await expect(table.getByRole("columnheader", { name: "Tokens" })).toBeAttached();
  await expect(page.getByText("CANARY")).toHaveCount(0);
  await expect(page.getByText(/SYNTHETIC-(REPLY|PROMPT)-TEXT/)).toHaveCount(0);
});

test("a click on a session selects it and keeps the day in the URL", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.goto(SESSIONS);
  await sessionLinks(page).nth(1).click();
  await expect(page).toHaveURL(/session=sess-attended-1/);
  await expect(page).toHaveURL(new RegExp(`day=${DAY}`));
  await expect(sessionLinks(page).nth(1)).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("heading", { level: 2, name: /^factory-core:factory-next · / }),
  ).toBeVisible();
});

test("a client scope shows only the sessions of its repos", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.goto(`${SESSIONS}&client=acme`);
  await expect(sessionLinks(page)).toHaveCount(1);
  await expect(sessionLinks(page).first()).toContainText("factory-core:factory-run");
  await expect(sessionLinks(page).first()).toHaveAttribute("href", /client=acme/);
  await expect(page.getByRole("link", { name: "Sessions", exact: true })).toHaveAttribute(
    "href",
    /client=acme/,
  );
});

test("Previous day shows a day with no session", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.goto(SESSIONS);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByText("No sessions on this day in this scope.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next day" })).toBeEnabled();
});

test("today is the default day and Next day is off", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { level: 1, name: "Sessions today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  await expect(page.getByText("No sessions on this day in this scope.")).toBeVisible();
});

test("a session that does not exist shows a message and the list", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.goto(`${SESSIONS}&session=s9`);
  await expect(page.getByText("No session s9 on this day in this scope.")).toBeVisible();
  await expect(sessionLinks(page)).toHaveCount(3);
});

const PAGES: [string, string, string][] = [
  ["sessions", "the sessions of one day", `${SESSIONS}&session=sess-night-1`],
  ["sessions", "a client scope", `${SESSIONS}&client=acme&session=sess-night-1`],
  ["sessions", "the second session", `${SESSIONS}&session=sess-attended-1`],
  ["usage-empty", "no session on the day", SESSIONS],
];

for (const scheme of ["light", "dark"] as const) {
  for (const [set, name, path] of PAGES) {
    test(`${name} has no WCAG 2.2 AA violations in the ${scheme} theme and no horizontal scroll at 375 px`, async ({
      page,
    }) => {
      await useFixture(set === "sessions" ? "sessions" : "usage-empty", NOW);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expect(page.getByText("Usage data as of")).toBeVisible();
      if (set === "sessions") await expect(spanRows(page).first()).toBeVisible();
      else await expect(page.getByText("No sessions on this day in this scope.")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
      const overflow = await page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );
      expect(Number(overflow)).toBeLessThanOrEqual(0);
    });
  }
}
