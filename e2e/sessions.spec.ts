import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { sessionsDay } from "./fixtures/session-transcripts.ts";
import { type FixtureName, HOSTILE_TITLE } from "./fixtures/sets.ts";
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
    page.getByText("Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON"),
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

const NIGHT = `${SESSIONS}&session=sess-night-1`;
const workItem = (page: Page, reference: string) =>
  spanRows(page).filter({ hasText: reference }).first();

test("a real fetch gives the work items of the spans their titles and links", async ({ page }) => {
  await useFixture("sessions-connected", NOW);
  await page.goto(NIGHT);
  const first = spanRows(page).filter({ hasText: "acme/app #11" }).first();
  await expect(first).toContainText("Add the export");
  await expect(first.getByRole("link", { name: /acme\/app #11/ })).toHaveAttribute(
    "href",
    "https://forge.synthetic.test/acme/app/issues/11",
  );
  await expect(page.getByText("Data is not complete")).toHaveCount(0);
  await expect(page.getByText(/^Not connected\./)).toHaveCount(0);
});

test("a title with markup shows as plain text and makes no request to its host", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await useFixture("sessions-connected", NOW);
  await page.goto(NIGHT);
  const row = workItem(page, "acme/app #12");
  await expect(row).toContainText(HOSTILE_TITLE);
  await expect(row.locator("img")).toHaveCount(0);
  await expect(row.locator(".span-item strong, .span-item b")).toHaveCount(0);
  await expect(row.getByRole("link", { name: /this/ })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeAttached();
  expect(requests.filter((url) => url.includes("evil.test"))).toEqual([]);
});

test("a repo with no token shows its work items by number and the note names it", async ({
  page,
}) => {
  await useFixture("sessions-partial", NOW);
  await page.goto(`${NIGHT}&client=acme`);
  const web = workItem(page, "partner/web #7");
  await expect(web).toBeVisible();
  await expect(web).not.toContainText("Fetched menu");
  await expect(web.getByRole("link")).toHaveCount(0);
  await expect(workItem(page, "acme/app #11")).toContainText("Add the export");
  await expect(page.getByText("Data is not complete: 1 repo not connected.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Repos" })).toHaveAttribute("href", /client=acme/);
});

test("with no token the spans show with numbers only and the page says Not connected", async ({
  page,
}) => {
  await useFixture("sessions-not-connected", NOW);
  await page.goto(NIGHT);
  await expect(spanRows(page).first()).toBeVisible();
  await expect(workItem(page, "acme/app #11")).not.toContainText("Add the export");
  await expect(workItem(page, "acme/app #11").getByRole("link")).toHaveCount(0);
  await expect(
    page.getByText("Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON"),
  ).toBeVisible();
  await expect(page.getByText("Data is not complete")).toHaveCount(0);
});

test("the spans show their token counts short and the table shows them in full", async ({
  page,
}) => {
  await useFixture("sessions", NOW);
  await page.goto(NIGHT);
  // The software-developer sub-agent of issue 11 has 3 Turns of 1,200 tokens.
  const row = spanRows(page)
    .filter({ hasText: "acme/app #11" })
    .filter({ hasText: "software-developer" });
  await expect(row).toContainText("3.6K");
  await expect(page.getByRole("table").getByRole("cell", { name: "3,600" })).toBeAttached();
});

test("the times follow the time zone of the browser", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  await useFixture("sessions", NOW);
  await page.goto(`/sessions?day=${DAY}&session=sess-attended-1`);
  // The Turns run from 10:01 to 10:05 UTC, which is 11:01 to 11:05 in Berlin.
  await expect(page.locator("#timeline-heading")).toContainText("11:01 to 11:05");
  await context.close();
});

test("Show more sessions loads the second page of the list", async ({ page }) => {
  await useFixture("sessions-many", NOW);
  await page.goto(SESSIONS);
  await expect(sessionLinks(page)).toHaveCount(50);
  await page.getByRole("button", { name: "Show more sessions" }).click();
  await expect(sessionLinks(page)).toHaveCount(51);
  await expect(page.getByRole("button", { name: "Show more sessions" })).toHaveCount(0);
});

test("an earlier day does not ask for the sessions again after 60 seconds", async ({ page }) => {
  await useFixture("sessions", NOW);
  await page.clock.install();
  let asked = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/sessions") asked += 1;
  });
  await page.goto(NIGHT);
  await expect(spanRows(page).first()).toBeVisible();
  const before = asked;
  await page.clock.fastForward(61_000);
  await page.waitForTimeout(500);
  expect(asked).toBe(before);
});

const PAGES: [FixtureName, string, string][] = [
  ["sessions", "the sessions of one day", NIGHT],
  ["sessions", "a client scope", `${SESSIONS}&client=acme&session=sess-night-1`],
  ["sessions", "the second session", `${SESSIONS}&session=sess-attended-1`],
  ["sessions-connected", "a connected repo list", NIGHT],
  ["sessions-partial", "a partly connected repo list", `${NIGHT}&client=acme`],
  ["sessions-not-connected", "no repo connected", NIGHT],
  ["usage-empty", "no session on the day", SESSIONS],
];

for (const scheme of ["light", "dark"] as const) {
  for (const [set, name, path] of PAGES) {
    test(`${name} has no WCAG 2.2 AA violations in the ${scheme} theme and no horizontal scroll at 375 px`, async ({
      page,
    }) => {
      await useFixture(set, NOW);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expect(page.getByText("Usage data as of")).toBeVisible();
      if (set === "usage-empty")
        await expect(page.getByText("No sessions on this day in this scope.")).toBeVisible();
      else {
        await expect(spanRows(page).first()).toBeVisible();
        const types = await spanRows(page).allTextContents();
        expect(
          types.every((text) => /main|software-developer|review-finder|sub-agent/.test(text)),
        ).toBe(true);
      }
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
      expect(results.violations).toEqual([]);
      const overflow = await page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );
      expect(Number(overflow)).toBeLessThanOrEqual(0);
    });
  }
}
