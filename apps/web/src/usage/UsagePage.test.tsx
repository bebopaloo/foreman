import type { BreakdownResponse, SeriesResponse } from "@foreman/shared";
import { ESTIMATE_NOTE } from "@foreman/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test-server.ts";
import { fakeApi, renderApp } from "../test-render.tsx";

const counts = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

const totals = {
  inputTokens: 1_200_000,
  outputTokens: 300_000,
  cacheWriteTokens: 500_000,
  cacheReadTokens: 10_400_000,
  turns: 90,
  estimate: 41.27,
  unpricedTurns: 0,
};

function breakdown(patch: Partial<BreakdownResponse["totals"]> = {}, unpriced = 0) {
  return {
    rows: [],
    totals: { ...totals, ...patch },
    rowCount: 0,
    unpricedModels: unpriced === 0 ? [] : [{ model: "synthetic-model-x", turns: unpriced }],
    note: ESTIMATE_NOTE,
  } satisfies BreakdownResponse;
}

function days(): SeriesResponse["buckets"] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = String(2 + index).padStart(2, "0");
    const zero = day === "04" || day === "08";
    return {
      start: `2026-11-${day}`,
      ...counts,
      inputTokens: zero ? 0 : 1000 * (index + 1),
      turns: zero ? 0 : 2,
      estimate: zero ? 0 : 0.5,
      unpricedTurns: 0,
    };
  });
}

interface Fake {
  breakdown?: BreakdownResponse | number;
  series?: SeriesResponse["buckets"] | number;
  unpriced?: SeriesResponse["unpricedModels"];
  status?: object;
}

/** Fakes the usage routes. The returned list holds each usage request as path and query. */
function fakeUsage(fake: Fake = {}): string[] {
  fakeApi();
  const requests: string[] = [];
  const respond = (status: number | object | undefined, body: () => object) =>
    typeof status === "number"
      ? new HttpResponse(null, { status })
      : HttpResponse.json(status ?? body());
  server.use(
    http.get("*/api/usage/status", () =>
      HttpResponse.json({
        state: "idle",
        filesRead: null,
        filesTotal: null,
        dataAsOf: "2026-11-15T09:42:00.000Z",
        reason: null,
        ...fake.status,
      }),
    ),
    http.get("*/api/usage/breakdown", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return respond(fake.breakdown, () => breakdown());
    }),
    http.get("*/api/usage/series", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return typeof fake.series === "number"
        ? new HttpResponse(null, { status: fake.series })
        : HttpResponse.json({
            buckets: fake.series ?? days(),
            unpricedModels: fake.unpriced ?? [],
            note: ESTIMATE_NOTE,
          });
    }),
    http.get("*/api/usage/limits", ({ request }) => {
      requests.push(new URL(request.url).pathname);
      return HttpResponse.json({ windows: [], latest: { five_hour: null, seven_day: null } });
    }),
  );
  return requests;
}

// jsdom has no date picker: userEvent cannot type a whole date into a controlled date input.
const changeDate = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const params = () => Object.fromEntries(new URLSearchParams(window.location.search));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  window.history.replaceState(null, "", "/usage");
});

afterEach(() => {
  vi.useRealTimers();
});

const tile = () => screen.findByRole("region", { name: /^Tokens, / });

describe("the view and its defaults", () => {
  it("shows the last 14 days, writes the defaults to the URL and marks Usage as current", async () => {
    const requests = fakeUsage();
    renderApp();
    expect(await screen.findByRole("region", { name: "Tokens, last 14 days" })).toBeInTheDocument();
    expect(params()).toMatchObject({
      range: "14d",
      grain: "day",
      metric: "tokens",
      tab: "project",
    });
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Range")).toHaveValue("14d");
    expect(screen.getByLabelText("From")).toHaveValue("2026-11-02");
    expect(screen.getByLabelText("To")).toHaveValue("2026-11-15");
    await screen.findByRole("table", { name: "Tokens by day" });
    expect(requests.some((r) => r.includes("from=2026-11-02&to=2026-11-15"))).toBe(true);
  });
});

describe("the summary tiles", () => {
  it("shows the tokens, the list-price estimate and its note", async () => {
    fakeUsage();
    renderApp();
    const region = await tile();
    expect(within(region).getByText("12.4M")).toBeInTheDocument();
    expect(within(region).getByText("List-price estimate $41.27")).toBeInTheDocument();
    expect(within(region).getByText(ESTIMATE_NOTE)).toBeInTheDocument();
  });

  it("shows a missing estimate as a dash", async () => {
    fakeUsage({ breakdown: breakdown({ estimate: null }) });
    renderApp();
    expect(await screen.findByText("List-price estimate —")).toBeInTheDocument();
  });
});

describe("unpriced turns", () => {
  it("shows them on the estimate tile and on the Usage over time panel", async () => {
    fakeUsage({
      breakdown: breakdown({ unpricedTurns: 3 }, 3),
      unpriced: [{ model: "synthetic-model-x", turns: 3 }],
    });
    window.history.replaceState(null, "", "/usage?metric=estimate");
    renderApp();
    await screen.findByRole("table", { name: "List-price estimate by day" });
    expect(await screen.findAllByText("3 turns unpriced (model synthetic-model-x)")).toHaveLength(
      2,
    );
  });
});

describe("usage in a client scope", () => {
  it("sends the client, shows the limit note and sends no request to /limits", async () => {
    const requests = fakeUsage();
    window.history.replaceState(null, "", "/usage?client=acme");
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    expect(
      screen.getByText("Limit windows are plan-wide. They show only in the scope All."),
    ).toBeInTheDocument();
    expect(requests.filter((r) => r.includes("/breakdown") || r.includes("/series"))).toSatisfy(
      (list: string[]) => list.length > 0 && list.every((r) => r.includes("client=acme")),
    );
    expect(requests.some((r) => r.includes("/limits"))).toBe(false);
  });

  it("shows no limit note and sends no client in the scope All", async () => {
    const requests = fakeUsage();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    expect(screen.queryByText(/Limit windows are plan-wide/)).not.toBeInTheDocument();
    expect(requests.some((r) => r.includes("client="))).toBe(false);
  });
});

describe("the metric switch", () => {
  it("changes the chart and the URL each time", async () => {
    fakeUsage();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    await user.click(screen.getByRole("radio", { name: "Turns" }));
    expect(await screen.findByRole("table", { name: "Turns by day" })).toBeInTheDocument();
    expect(params().metric).toBe("turns");
    await user.click(screen.getByRole("radio", { name: "List-price estimate" }));
    expect(
      await screen.findByRole("table", { name: "List-price estimate by day" }),
    ).toBeInTheDocument();
    expect(params().metric).toBe("estimate");
  });

  it("changes the grain", async () => {
    fakeUsage();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    await user.selectOptions(screen.getByLabelText("Grain"), "week");
    expect(await screen.findByRole("table", { name: "Tokens by week" })).toBeInTheDocument();
    expect(params().grain).toBe("week");
  });
});

describe("browser Back", () => {
  it("undoes each change of the Operator", async () => {
    fakeUsage();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    await user.selectOptions(screen.getByLabelText("Range"), "30d");
    await user.click(screen.getByRole("radio", { name: "Turns" }));
    expect(await screen.findByRole("region", { name: "Tokens, last 30 days" })).toBeInTheDocument();
    const back = async () => {
      const popped = new Promise((resolve) => {
        window.addEventListener("popstate", resolve, { once: true });
      });
      window.history.back();
      await popped;
    };
    await back();
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Tokens" })).toBeChecked();
    });
    expect(screen.getByLabelText("Range")).toHaveValue("30d");
    await back();
    await waitFor(() => {
      expect(screen.getByLabelText("Range")).toHaveValue("14d");
    });
  });
});

describe("an invalid URL value", () => {
  it.each(["?range=0d&grain=hour&metric=cost", "?from=2026-11-20&to=2026-11-01"])(
    "uses the defaults for %s and says so",
    async (search) => {
      fakeUsage();
      window.history.replaceState(null, "", `/usage${search}`);
      renderApp();
      expect(
        await screen.findByText(
          "The link has a value that is not valid. The page shows the defaults for it.",
        ),
      ).toBeInTheDocument();
      expect(params()).toMatchObject({ range: "14d", grain: "day", metric: "tokens" });
      expect(params().from).toBeUndefined();
      expect(await screen.findByRole("region", { name: "Tokens, last 14 days" })).toBeVisible();
    },
  );

  it("shows no message for a valid URL", async () => {
    fakeUsage();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    expect(screen.queryByText(/not valid/)).not.toBeInTheDocument();
  });
});

describe("an absolute range", () => {
  it("writes the dates with no range and names them on the tile", async () => {
    fakeUsage();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    changeDate("From", "2026-10-01");
    changeDate("To", "2026-10-31");
    expect(params()).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(params().range).toBeUndefined();
    expect(
      await screen.findByRole("region", { name: "Tokens, 1 Oct 2026 to 31 Oct 2026" }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Range"), "7d");
    expect(params().from).toBeUndefined();
    expect(params().range).toBe("7d");
  });

  it("moves the other date when one date would end the range before it starts", async () => {
    fakeUsage();
    renderApp();
    await screen.findByRole("table", { name: "Tokens by day" });
    changeDate("To", "2026-10-31");
    expect(params()).toMatchObject({ from: "2026-10-31", to: "2026-10-31" });
  });

  it("shows months when the range is too long for its grain", async () => {
    fakeUsage();
    window.history.replaceState(null, "", "/usage?from=2000-01-01&to=2026-11-15");
    renderApp();
    expect(
      await screen.findByText("The range is too long for this grain. The page shows months."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Tokens by month" })).toBeInTheDocument();
  });
});

describe("usage over time", () => {
  it("shows 14 bars with zero bars, and a table of the same values", async () => {
    fakeUsage();
    renderApp();
    const table = await screen.findByRole("table", { name: "Tokens by day" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(14);
    const values = Object.fromEntries(
      rows.map((row) => [
        within(row).getByRole("rowheader").textContent,
        within(row).getByRole("cell").textContent,
      ]),
    );
    expect(values["4 Nov"]).toBe("0");
    expect(values["8 Nov"]).toBe("0");
    expect(values["2 Nov"]).toBe("1K");
  });

  it("shows the sentence of the panel", async () => {
    fakeUsage();
    renderApp();
    expect(
      await screen.findByText("From the Usage index: tokens for each day."),
    ).toBeInTheDocument();
  });
});

describe("no usage in the range", () => {
  it("shows one sentence in each panel", async () => {
    fakeUsage({
      breakdown: breakdown({
        turns: 0,
        estimate: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
      series: days().map((bucket) => ({ ...bucket, turns: 0, inputTokens: 0 })),
    });
    renderApp();
    expect(await screen.findAllByText("No usage in this range in this scope.")).toHaveLength(2);
  });
});

describe("a panel fails", () => {
  it("shows a status line in the tile and the other panel still shows its data", async () => {
    fakeUsage({ breakdown: 500 });
    renderApp();
    const status = await screen.findByText("This panel cannot load the data. Try Refresh.");
    expect(status).toHaveAttribute("role", "status");
    expect(await screen.findByRole("table", { name: "Tokens by day" })).toBeInTheDocument();
  });

  it("shows a status line in Usage over time and the tile still shows its data", async () => {
    fakeUsage({ series: 500 });
    renderApp();
    expect(await screen.findByText("12.4M")).toBeInTheDocument();
    expect(
      await screen.findByText("This panel cannot load the data. Try Refresh."),
    ).toHaveAttribute("role", "status");
  });
});

describe("loading", () => {
  it("shows a skeleton for each panel until the data arrives", async () => {
    fakeUsage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/usage/breakdown", async () => {
        await gate;
        return HttpResponse.json(breakdown());
      }),
      http.get("*/api/usage/series", async () => {
        await gate;
        return HttpResponse.json({ buckets: days(), unpricedModels: [], note: ESTIMATE_NOTE });
      }),
    );
    renderApp();
    expect(await screen.findByRole("status", { name: "Loading the tokens tile" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Loading Usage over time" })).toBeVisible();
    release();
    expect(await screen.findByText("12.4M")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /^Loading/ })).not.toBeInTheDocument();
  });
});

describe("the footer of the page", () => {
  it("names the time zone", async () => {
    fakeUsage();
    renderApp();
    expect(await screen.findByText(/^Times in /)).toBeInTheDocument();
  });
});
