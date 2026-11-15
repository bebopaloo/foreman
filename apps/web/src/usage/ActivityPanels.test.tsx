import type { BreakdownResponse, SeriesResponse } from "@foreman/shared";
import { ESTIMATE_NOTE } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

type Bucket = SeriesResponse["buckets"][number];

const bucket = (start: string, patch: Partial<Bucket> = {}): Bucket => ({
  start,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
  estimate: 0,
  unpricedTurns: 0,
  ...patch,
});

interface Fake {
  totals?: Partial<BreakdownResponse["totals"]>;
  /** The buckets of the request that starts at `from`. */
  series?: Record<string, Bucket[]>;
  unpriced?: SeriesResponse["unpricedModels"];
  failSeries?: boolean;
}

/** Fakes the usage routes. The list holds the query of each series request. */
function fakeUsage(fake: Fake = {}): string[] {
  fakeApi();
  const requests: string[] = [];
  server.use(
    http.get("*/api/usage/status", () =>
      HttpResponse.json({
        state: "idle",
        filesRead: null,
        filesTotal: null,
        dataAsOf: "2026-11-15T09:42:00.000Z",
        reason: null,
      }),
    ),
    http.get("*/api/usage/breakdown", () =>
      HttpResponse.json({
        rows: [],
        totals: {
          inputTokens: 100_000,
          outputTokens: 20_000,
          cacheWriteTokens: 50_000,
          cacheReadTokens: 850_000,
          turns: 9,
          estimate: 5,
          unpricedTurns: 0,
          ...fake.totals,
        },
        rowCount: 0,
        unpricedModels: [],
        note: ESTIMATE_NOTE,
      } satisfies BreakdownResponse),
    ),
    http.get("*/api/usage/series", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      if (fake.failSeries === true) return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({
        buckets: fake.series?.[url.searchParams.get("from") ?? ""] ?? [],
        unpricedModels: fake.unpriced ?? [],
        note: ESTIMATE_NOTE,
      });
    }),
    http.get("*/api/usage/limits", () =>
      HttpResponse.json({ windows: [], latest: { five_hour: null, seven_day: null } }),
    ),
  );
  return requests;
}

const CALENDAR_FROM = "2026-05-18";
const MONTH_FROM = "2026-11-01";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  window.history.replaceState(null, "", "/usage");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Activity calendar", () => {
  const busy = [
    bucket("2026-11-13", { turns: 4, inputTokens: 1_200_000 }),
    bucket("2026-11-12", { turns: 1, inputTokens: 100_000 }),
  ];

  it("shows the 26 weeks up to today, with weeks that start on Monday, and its sentence", async () => {
    const requests = fakeUsage({ series: { [CALENDAR_FROM]: busy } });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Activity calendar" });
    expect(
      await within(panel).findByText(
        "From the Usage index. Last 26 weeks. This panel ignores the date range.",
      ),
    ).toBeInTheDocument();
    const grid = await within(panel).findByRole("table", {
      name: "Tokens per day in the last 26 weeks",
    });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(26);
    expect(within(grid).getAllByRole("img")).toHaveLength(26 * 7);
    expect(
      within(grid).getByRole("columnheader", { name: "Week of 2026-05-18" }),
    ).toBeInTheDocument();
    expect(within(grid).getByRole("img", { name: "13 Nov 2026: 1.2M tokens" })).toBeInTheDocument();
    expect(within(grid).getByRole("img", { name: "14 Nov 2026: 0 tokens" })).toBeInTheDocument();
    expect(requests.some((query) => query.includes(`from=${CALENDAR_FROM}&to=2026-11-15`))).toBe(
      true,
    );
    expect(requests.some((query) => query.includes("grain=day"))).toBe(true);
  });

  it("has a legend with the levels and uses a level 4 cell for the largest day", async () => {
    fakeUsage({ series: { [CALENDAR_FROM]: busy } });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Activity calendar" });
    const grid = await within(panel).findByRole("table", { name: /per day/ });
    expect(within(grid).getByRole("img", { name: /^13 Nov 2026/ })).toHaveClass("level-4");
    expect(within(grid).getByRole("img", { name: /^12 Nov 2026/ })).toHaveClass("level-1");
    expect(within(grid).getByRole("img", { name: /^11 Nov 2026/ })).toHaveClass("level-0");
    for (const name of ["no usage", "up to 25%", "up to 50%", "up to 75%", "more"]) {
      expect(within(panel).getByText(name)).toBeInTheDocument();
    }
  });

  it("uses the metric and ignores the range", async () => {
    window.history.replaceState(null, "", "/usage?metric=turns&range=30d");
    const requests = fakeUsage({ series: { [CALENDAR_FROM]: busy } });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Activity calendar" });
    const grid = await within(panel).findByRole("table", {
      name: "Turns per day in the last 26 weeks",
    });
    expect(within(grid).getByRole("img", { name: "13 Nov 2026: 4 turns" })).toBeInTheDocument();
    expect(within(grid).getByRole("img", { name: "12 Nov 2026: 1 turn" })).toBeInTheDocument();
    expect(requests.some((query) => query.includes(`from=${CALENDAR_FROM}`))).toBe(true);
  });

  it("changes when the Operator selects another metric", async () => {
    fakeUsage({ series: { [CALENDAR_FROM]: busy } });
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Tokens per day in the last 26 weeks" });
    await user.click(screen.getByRole("radio", { name: "Turns" }));
    expect(
      await screen.findByRole("table", { name: "Turns per day in the last 26 weeks" }),
    ).toBeInTheDocument();
  });

  it("shows one sentence with no usage in the 26 weeks", async () => {
    fakeUsage();
    renderApp();
    expect(
      await screen.findByText("No usage in the last 26 weeks in this scope."),
    ).toBeInTheDocument();
  });

  it("sends the client of the scope", async () => {
    window.history.replaceState(null, "", "/usage?client=acme");
    const requests = fakeUsage();
    renderApp();
    await screen.findByText("No usage in the last 26 weeks in this scope.");
    expect(requests.every((query) => query.includes("client=acme"))).toBe(true);
  });
});

describe("Cache efficiency", () => {
  it("shows the cache hit ratio and the tokens from the cache", async () => {
    fakeUsage();
    renderApp();
    const panel = await screen.findByRole("region", { name: "Cache efficiency" });
    expect(await within(panel).findByText("Cache hit ratio 85%")).toBeInTheDocument();
    expect(within(panel).getByText("850K input tokens came from the cache")).toBeInTheDocument();
  });

  it("shows a sentence when the range has no input token", async () => {
    fakeUsage({
      totals: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
    });
    renderApp();
    expect(await screen.findByText("No input tokens in this range.")).toBeInTheDocument();
  });

  it("shows the sentence of an empty range", async () => {
    fakeUsage({ totals: { turns: 0 } });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Cache efficiency" });
    expect(
      await within(panel).findByText("No usage in this range in this scope."),
    ).toBeInTheDocument();
  });
});

describe("Month outlook", () => {
  const month = [
    bucket("2026-11-01", { turns: 3, estimate: 10 }),
    bucket("2026-11-14", { turns: 2, estimate: 20 }),
  ];

  it("shows the amount so far, the projection and its sentence", async () => {
    const requests = fakeUsage({ series: { [MONTH_FROM]: month } });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Month outlook" });
    expect(await within(panel).findByText("$30.00 so far this month")).toBeInTheDocument();
    expect(within(panel).getByText("Projection to 30 Nov: $60.00")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "The projection takes the average per day so far this month, times the days of the month. This panel ignores the date range.",
      ),
    ).toBeInTheDocument();
    expect(requests.some((query) => query.includes(`from=${MONTH_FROM}&to=2026-11-15`))).toBe(true);
  });

  it("shows the unpriced note and a dash when no turn has a price", async () => {
    fakeUsage({
      series: { [MONTH_FROM]: [bucket("2026-11-02", { turns: 3, estimate: null })] },
      unpriced: [{ model: "synthetic-model-x", turns: 3 }],
    });
    renderApp();
    const panel = await screen.findByRole("region", { name: "Month outlook" });
    expect(await within(panel).findByText("— so far this month")).toBeInTheDocument();
    expect(within(panel).getByText("Projection to 30 Nov: —")).toBeInTheDocument();
    expect(
      within(panel).getByText("3 turns unpriced (model synthetic-model-x)"),
    ).toBeInTheDocument();
  });

  it("shows one sentence when the month has no usage", async () => {
    fakeUsage();
    renderApp();
    expect(
      await screen.findByText("No usage so far this month in this scope."),
    ).toBeInTheDocument();
  });
});

describe("a panel fails", () => {
  it("shows a status line in each panel that reads a series, and the cache panel shows its data", async () => {
    fakeUsage({ failSeries: true });
    renderApp();
    for (const name of ["Activity calendar", "Month outlook"]) {
      const panel = await screen.findByRole("region", { name });
      expect(
        await within(panel).findByText("This panel cannot load the data. Try Refresh."),
      ).toHaveAttribute("role", "status");
    }
    expect(await screen.findByText("Cache hit ratio 85%")).toBeInTheDocument();
  });
});
