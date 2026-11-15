import type { LimitsResponse } from "@foreman/shared";
import { ESTIMATE_NOTE } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const NONE: LimitsResponse = { windows: [], latest: { five_hour: null, seven_day: null } };

const totals = {
  inputTokens: 1000,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  turns: 2,
  estimate: 1,
  unpricedTurns: 0,
};

/** Fakes the usage routes with the given limits. The list holds each request to /limits. */
function fakeLimits(limits: LimitsResponse | number = NONE): string[] {
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
        totals,
        rowCount: 0,
        unpricedModels: [],
        note: ESTIMATE_NOTE,
      }),
    ),
    http.get("*/api/usage/series", () =>
      HttpResponse.json({ buckets: [], unpricedModels: [], note: ESTIMATE_NOTE }),
    ),
    http.get("*/api/usage/limits", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return typeof limits === "number"
        ? new HttpResponse(null, { status: limits })
        : HttpResponse.json(limits);
    }),
  );
  return requests;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  window.history.replaceState(null, "", "/usage");
});

afterEach(() => {
  vi.useRealTimers();
});

const latest = (
  fiveHour: LimitsResponse["latest"]["five_hour"],
  sevenDay: LimitsResponse["latest"]["seven_day"] = null,
) => ({ windows: [], latest: { five_hour: fiveHour, seven_day: sevenDay } }) as LimitsResponse;

describe("the latest Limit readings", () => {
  it("shows the percentage, the reset time and the reading time in each tile", async () => {
    const requests = fakeLimits(
      latest(
        {
          time: "2026-11-15T09:41:00.000Z",
          usedPercentage: 62,
          resetsAt: "2026-11-15T13:00:00.000Z",
        },
        {
          time: "2026-11-15T09:41:00.000Z",
          usedPercentage: 48,
          resetsAt: "2026-11-19T09:00:00.000Z",
        },
      ),
    );
    renderApp();
    const five = await screen.findByRole("region", { name: "5-hour window" });
    expect(within(five).getByText("62%")).toBeInTheDocument();
    expect(within(five).getByText("resets 13:00")).toBeInTheDocument();
    expect(within(five).getByText("latest reading 09:41, 2 hours ago")).toBeInTheDocument();
    expect(within(five).getByText("under 70%")).toBeInTheDocument();
    expect(within(five).getByText("Plan-wide: all clients and Projects")).toBeInTheDocument();
    const seven = screen.getByRole("region", { name: "7-day window" });
    expect(within(seven).getByText("48%")).toBeInTheDocument();
    expect(within(seven).getByText("resets Thu 19 Nov, 09:00")).toBeInTheDocument();
    expect(within(seven).getByText("latest reading 09:41, 2 hours ago")).toBeInTheDocument();
    expect(within(seven).getByText("Plan-wide: all clients and Projects")).toBeInTheDocument();
    expect(requests[0]).not.toContain("client");
  });

  it("shows the state word of a high reading", async () => {
    fakeLimits(
      latest({
        time: "2026-11-15T09:41:00.000Z",
        usedPercentage: 93,
        resetsAt: "2026-11-15T13:00:00.000Z",
      }),
    );
    renderApp();
    const five = await screen.findByRole("region", { name: "5-hour window" });
    expect(within(five).getByText("90% or more")).toBeInTheDocument();
  });
});

describe("a window that reset after its latest reading", () => {
  it("shows the reset time and no percentage", async () => {
    fakeLimits(
      latest({
        time: "2026-11-15T07:10:00.000Z",
        usedPercentage: 81,
        resetsAt: "2026-11-15T09:00:00.000Z",
      }),
    );
    renderApp();
    const five = await screen.findByRole("region", { name: "5-hour window" });
    expect(
      within(five).getByText("The window reset at 09:00. No reading since."),
    ).toBeInTheDocument();
    expect(within(five).queryByText("81%")).not.toBeInTheDocument();
  });
});

describe("no limit reading", () => {
  it("shows No reading in each tile and each chart, and the other panels show their data", async () => {
    fakeLimits();
    renderApp();
    expect(await screen.findByText("1K")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "5-hour window" })).getByText("No reading"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "7-day window" })).getByText("No reading"),
    ).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "Limit history" });
    expect(within(history).getAllByText("No reading")).toHaveLength(2);
  });

  it("shows a status line in each limit panel when the request fails", async () => {
    fakeLimits(500);
    renderApp();
    const history = await screen.findByRole("region", { name: "Limit history" });
    expect(
      await within(history).findByText("This panel cannot load the data. Try Refresh."),
    ).toHaveAttribute("role", "status");
    expect(await screen.findByText("1K")).toBeInTheDocument();
  });
});

function row(rows: HTMLElement[], index: number): HTMLElement {
  const found = rows[index];
  if (found === undefined) throw new Error(`No row ${String(index)}`);
  return found;
}

describe("Limit history", () => {
  const peaks = [35, 52, 64, 71, 88, 90, 93, 60, 97, 45, 91, 69];
  const history: LimitsResponse = {
    windows: peaks.map((peak, index) => ({
      window: "seven_day" as const,
      resetsAt: new Date(Date.UTC(2026, 8, 1 + index * 7, 9)).toISOString(),
      peakUsedPercentage: peak,
    })),
    latest: { five_hour: null, seven_day: null },
  };

  it("shows 12 bars with the state word of each, and the summary", async () => {
    window.history.replaceState(null, "", "/usage?range=12w");
    fakeLimits(history);
    renderApp();
    const table = await screen.findByRole("table", { name: "7-day windows" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(13);
    expect(within(row(rows, 1)).getByText("under 70%")).toBeInTheDocument();
    expect(within(row(rows, 4)).getByText("70% or more")).toBeInTheDocument();
    expect(within(row(rows, 7)).getByText("90% or more")).toBeInTheDocument();
    expect(
      screen.getByText("4 of the last 12 7-day windows reached 90% or more"),
    ).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Limit history" });
    expect(within(panel).getByText("No reading")).toBeInTheDocument();
    expect(within(panel).getByText("90% or more", { selector: "li" })).toBeInTheDocument();
  });

  it("says when the range holds no window but there is a reading", async () => {
    fakeLimits({
      windows: [],
      latest: {
        five_hour: null,
        seven_day: {
          time: "2026-11-15T09:41:00.000Z",
          usedPercentage: 48,
          resetsAt: "2026-11-19T09:00:00.000Z",
        },
      },
    });
    window.history.replaceState(null, "", "/usage?from=2026-10-01&to=2026-10-31");
    renderApp();
    const panel = await screen.findByRole("region", { name: "Limit history" });
    expect(await within(panel).findByText("No reading in this range")).toBeInTheDocument();
  });
});

describe("the window that runs now", () => {
  const running = {
    time: "2026-11-15T11:30:00.000Z",
    usedPercentage: 74,
    resetsAt: "2026-11-15T14:00:00.000Z",
  };

  it("labels the bar in progress with the peak so far, and asks for 7 days after today", async () => {
    const requests = fakeLimits({
      windows: [
        { window: "five_hour", resetsAt: "2026-11-15T08:00:00.000Z", peakUsedPercentage: 91 },
      ],
      latest: { five_hour: running, seven_day: null },
    });
    renderApp();
    const table = await screen.findByRole("table", { name: "5-hour windows" });
    const row = within(table).getByRole("row", { name: /in progress/ });
    expect(within(row).getByText("74%")).toBeInTheDocument();
    expect(within(row).getByText("70% or more")).toBeInTheDocument();
    expect(
      screen.getByText("1 of the last 2 5-hour windows reached 90% or more"),
    ).toBeInTheDocument();
    expect(requests[0]).toContain("to=2026-11-22");
  });

  it("uses the window of the API when the API lists it", async () => {
    fakeLimits({
      windows: [
        { window: "five_hour", resetsAt: "2026-11-15T14:00:00.000Z", peakUsedPercentage: 74 },
      ],
      latest: { five_hour: running, seven_day: null },
    });
    renderApp();
    const table = await screen.findByRole("table", { name: "5-hour windows" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("adds no window in progress to a range that ended before today", async () => {
    const requests = fakeLimits({
      windows: [],
      latest: { five_hour: running, seven_day: null },
    });
    window.history.replaceState(null, "", "/usage?from=2026-11-01&to=2026-11-10");
    renderApp();
    const panel = await screen.findByRole("region", { name: "Limit history" });
    expect(await within(panel).findByText("No reading in this range")).toBeInTheDocument();
    expect(requests[0]).toContain("to=2026-11-10");
  });
});

describe("Limit windows in a client scope", () => {
  it("shows no limit tile, no Limit history and sends no request to /limits", async () => {
    const requests = fakeLimits(
      latest({
        time: "2026-11-15T09:41:00.000Z",
        usedPercentage: 62,
        resetsAt: "2026-11-15T13:00:00.000Z",
      }),
    );
    window.history.replaceState(null, "", "/usage?client=acme");
    renderApp();
    expect(await screen.findByText("1K")).toBeInTheDocument();
    expect(
      screen.getByText("Limit windows are plan-wide. They show only in the scope All."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "5-hour window" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "7-day window" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Limit history" })).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });
});
