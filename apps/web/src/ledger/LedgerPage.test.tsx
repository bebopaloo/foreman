import type { LedgerResponse, LedgerRow, RefreshStatusResponse } from "@foreman/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const PROJECT = "0123456789ab";

const idleStatus: RefreshStatusResponse = {
  state: "idle",
  reason: null,
  filesRead: null,
  filesTotal: null,
  dataAsOf: "2026-11-15T06:00:00.000Z",
};

function row(day: string, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    day,
    projectId: PROJECT,
    repoId: "r1",
    label: "acme/payments-api",
    client: "acme",
    interactiveMinutes: 29,
    messages: 5,
    sessions: 1,
    tokens: 1_000_000,
    ...overrides,
  };
}

interface Served {
  /** The rows of each page. */
  pages?: LedgerRow[][];
  usageStatus?: () => RefreshStatusResponse;
  empty?: boolean;
}

/** Each request to the ledger route, as path and query. */
const requests: string[] = [];

function serve(options: Served = {}) {
  requests.length = 0;
  const pages = options.pages ?? [[row("2026-11-12")]];
  fakeApi();
  server.use(
    http.get("*/api/usage/status", () => HttpResponse.json(options.usageStatus?.() ?? idleStatus)),
    http.get("*/api/ledger", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const cursor = url.searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor);
      const rows = options.empty === true ? [] : (pages[index] ?? []);
      const all = options.empty === true ? [] : pages.flat();
      const body: LedgerResponse = {
        rules: { timeZone: "Europe/London", idleMinutes: 15, leadInMinutes: 2 },
        range: {
          from: url.searchParams.get("from") ?? "2026-11-01",
          to: url.searchParams.get("to") ?? "2026-11-15",
        },
        rows,
        rowCount: all.length,
        nextCursor: options.empty !== true && index + 1 < pages.length ? String(index + 1) : null,
        repos: {
          lines:
            all.length === 0
              ? []
              : [
                  {
                    projectId: PROJECT,
                    repoId: "r1",
                    label: "acme/payments-api",
                    client: "acme",
                    interactiveMinutes: 91,
                    days: 2,
                    sessions: 3,
                    tokens: 4_500_000,
                  },
                  {
                    projectId: "ba9876543210",
                    repoId: null,
                    label: "spike-cli",
                    client: null,
                    interactiveMinutes: 5,
                    days: 1,
                    sessions: 1,
                    tokens: 400,
                  },
                ],
          cut: 0,
        },
        totals: { interactiveMinutes: 96, messages: 7, sessions: 4, tokens: 4_500_400 },
      };
      return HttpResponse.json(body);
    }),
  );
}

function openPage(path: string) {
  window.history.replaceState(null, "", path);
  return renderApp();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page", () => {
  it("shows the notes, the rule, then the two tables, and marks the nav link", async () => {
    serve({ pages: [[row("2026-11-13"), row("2026-11-12", { interactiveMinutes: 62 })]] });
    openPage("/ledger");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Engagement ledger" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "From the times of your own messages. It never counts agents that worked alone.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Evidence for invoices and timesheets in a Solo build. It is an estimate from message times, not a record of hours worked.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(
        "Each of your messages adds the time since your previous message, when that time is 15 minutes or less. Else it adds 2 minutes. Days are in Europe/London.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Engagement ledger" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(requests).toEqual(["/api/ledger"]);

    const repos = await screen.findByRole("table", { name: "By client repo" });
    const repoRows = within(repos).getAllByRole("row");
    expect(within(repoRows[1] as HTMLElement).getAllByRole("cell")[0]).toHaveTextContent("acme");
    expect(repoRows[1]).toHaveTextContent("acme/payments-api");
    expect(repoRows[1]).toHaveTextContent("1 h 31 min");
    expect(repoRows[1]).toHaveTextContent("4.5M");
    expect(repoRows[2]).toHaveTextContent("spike-cli");
    expect(repoRows[2]).toHaveTextContent("Unassigned");
    expect(repoRows[3]).toHaveTextContent("Total");
    expect(repoRows[3]).toHaveTextContent("1 h 36 min");

    const days = screen.getByRole("table", { name: "By day" });
    expect(
      within(days)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Day", "Client repo", "Interactive time", "Messages", "Sessions", "Tokens"]);
    const dayRows = within(days).getAllByRole("row");
    expect(dayRows[1]).toHaveTextContent("13 Nov 2026");
    expect(dayRows[1]).toHaveTextContent("0 h 29 min");
    expect(dayRows[2]).toHaveTextContent("12 Nov 2026");
    expect(dayRows[2]).toHaveTextContent("1 h 2 min");
    expect(
      screen.getByText("Days are in Europe/London, the ledger's time zone, not the browser's."),
    ).toBeVisible();
  });

  it("keeps the Client scope in the request", async () => {
    serve();
    openPage("/ledger?client=acme");
    await screen.findByRole("table", { name: "By day" });
    expect(requests).toEqual(["/api/ledger?client=acme"]);
  });

  it("writes a label as text", async () => {
    serve({ pages: [[row("2026-11-12", { label: "<b>x</b>" })]] });
    openPage("/ledger");
    const days = await screen.findByRole("table", { name: "By day" });
    expect(within(days).getByText("<b>x</b>")).toBeVisible();
    expect(days.querySelector("b")).toBeNull();
  });
});

describe("show more rows", () => {
  it("loads the next page and removes the button after the last page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = Array.from({ length: 100 }, (_, index) =>
      row(`2026-11-${String(15 - Math.floor(index / 10)).padStart(2, "0")}`, {
        projectId: `${index.toString(16).padStart(12, "0")}`,
        label: `repo-${index.toString()}`,
      }),
    );
    const second = Array.from({ length: 30 }, (_, index) =>
      row("2026-11-05", {
        projectId: `${(index + 100).toString(16).padStart(12, "0")}`,
        label: `repo-${(index + 100).toString()}`,
      }),
    );
    serve({ pages: [first, second] });
    openPage("/ledger");
    const days = await screen.findByRole("table", { name: "By day" });
    expect(within(days).getAllByRole("row")).toHaveLength(1 + 100 + 1);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(days).getAllByRole("row")).toHaveLength(1 + 130 + 1);
    });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(requests[1]).toBe("/api/ledger?cursor=1");
  });
});

describe("range and Back", () => {
  it("writes Last month in the URL and goes back to this month", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve();
    openPage("/ledger");
    const last = await screen.findByRole("button", { name: "Last month" });
    await waitFor(() => {
      expect(last).toBeEnabled();
    });
    await user.click(last);
    expect(window.location.search).toBe("?from=2026-10-01&to=2026-10-31");
    await waitFor(() => {
      expect(requests).toContain("/api/ledger?from=2026-10-01&to=2026-10-31");
    });
    expect(screen.getByRole("button", { name: "Last month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await screen.findByLabelText("From")).toHaveValue("2026-10-01");

    window.history.back();
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("asks for two chosen dates and keeps the Client scope", async () => {
    serve();
    openPage("/ledger?client=acme");
    const from = await screen.findByLabelText("From");
    await waitFor(() => {
      expect(from).toHaveValue("2026-11-01");
    });
    // user-event cannot type a whole date into a date input in jsdom.
    fireEvent.change(from, { target: { value: "2026-11-03" } });
    expect(window.location.search).toContain("from=2026-11-03");
    expect(window.location.search).toContain("to=2026-11-15");
    expect(window.location.search).toContain("client=acme");
    await waitFor(() => {
      expect(requests).toContain("/api/ledger?from=2026-11-03&to=2026-11-15&client=acme");
    });
  });
});

describe("an invalid URL value", () => {
  it("shows this month and says so, with no new history entry", async () => {
    serve();
    const before = window.history.length;
    openPage("/ledger?from=2026-11-20&to=2026-11-01");
    expect(
      await screen.findByText("The link has a value that is not valid. The page shows this month."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await screen.findByRole("table", { name: "By day" });
    expect(requests).toEqual(["/api/ledger"]);
    expect(window.history.length).toBe(before);
  });
});

describe("nothing in the range", () => {
  it("shows one sentence in each table", async () => {
    serve({ empty: true });
    openPage("/ledger");
    const sentence = "No messages and no usage in this range in this scope.";
    expect(await screen.findAllByText(sentence)).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("refresh and live status", () => {
  it("shows the data time and loads the ledger again only when that time changed", async () => {
    let status = idleStatus;
    serve({ usageStatus: () => status });
    openPage("/ledger");
    expect(await screen.findByText(/Usage data as of/)).toBeVisible();
    await screen.findByRole("table", { name: "By day" });
    expect(requests).toHaveLength(1);

    // 60 seconds pass and the time is the same: no new request.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(1);

    status = { ...idleStatus, dataAsOf: "2026-11-15T12:01:00.000Z" };
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
  });

  it("shows the progress of a running refresh", async () => {
    serve({
      usageStatus: () => ({ ...idleStatus, state: "running", filesRead: 3, filesTotal: 10 }),
    });
    openPage("/ledger");
    expect(await screen.findByText("Reading the history: 3 of 10 files")).toBeVisible();
  });
});

describe("an error", () => {
  it("shows one status line", async () => {
    serve();
    server.use(http.get("*/api/ledger", () => HttpResponse.json({}, { status: 500 })));
    openPage("/ledger");
    expect(await screen.findByText(/The ledger cannot be read/)).toBeVisible();
  });
});
