import { ESTIMATE_NOTE, type BreakdownResponse } from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

type Row = BreakdownResponse["rows"][number];

const PAYMENTS = "aaaaaaaaaaaa";
const FOREMAN = "bbbbbbbbbbbb";
const SPIKE = "cccccccccccc";

function row(key: string, label: string, patch: Partial<Row> = {}): Row {
  return {
    key,
    label,
    inputTokens: 100_000,
    outputTokens: 20_000,
    cacheWriteTokens: 30_000,
    cacheReadTokens: 50_000,
    turns: 10,
    estimate: 1.5,
    unpricedTurns: 0,
    ...patch,
  };
}

const projectRows: Row[] = [
  row(PAYMENTS, "payments-api", {
    client: "acme",
    inputTokens: 4_000_000,
    outputTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    cacheReadTokens: 2_000_000,
    turns: 80,
    estimate: 20,
  }),
  row(FOREMAN, "foreman", {
    client: "bebopaloo",
    inputTokens: 1_500_000,
    outputTokens: 500_000,
    cacheWriteTokens: 500_000,
    cacheReadTokens: 500_000,
    turns: 30,
    estimate: 8,
  }),
  row(SPIKE, "spike-cli", {
    client: null,
    inputTokens: 200_000,
    outputTokens: 50_000,
    cacheWriteTokens: 50_000,
    cacheReadTokens: 100_000,
    turns: 5,
    estimate: null,
    unpricedTurns: 5,
  }),
];

function response(rows: Row[], rowCount = rows.length): BreakdownResponse {
  const sum = (
    field: "inputTokens" | "outputTokens" | "cacheWriteTokens" | "cacheReadTokens" | "turns",
  ) => rows.reduce((total, each) => total + each[field], 0);
  return {
    rows,
    totals: {
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cacheWriteTokens: sum("cacheWriteTokens"),
      cacheReadTokens: sum("cacheReadTokens"),
      turns: sum("turns"),
      estimate: 28,
      unpricedTurns: 0,
    },
    rowCount,
    unpricedModels: [],
    note: ESTIMATE_NOTE,
  };
}

const modelRows = [
  row("model-a", "model-a", { turns: 5, inputTokens: 900_000 }),
  row("model-b", "model-b", { turns: 50, inputTokens: 500_000 }),
  row("model-c", "model-c", { turns: 20, inputTokens: 100_000 }),
];

interface Fake {
  byDimension?: Record<string, BreakdownResponse>;
  projects?: object[];
}

const projectList = [
  {
    id: PAYMENTS,
    label: "payments-api",
    noRepo: false,
    client: "acme",
    firstTurnAt: "2026-11-01T08:00:00.000Z",
    lastTurnAt: "2026-11-14T08:00:00.000Z",
  },
  {
    id: FOREMAN,
    label: "foreman",
    noRepo: false,
    client: "bebopaloo",
    firstTurnAt: "2026-11-01T08:00:00.000Z",
    lastTurnAt: "2026-11-14T08:00:00.000Z",
  },
];

/** Fakes the usage routes. The returned list holds each request as path and query. */
function fakeUsage(fake: Fake = {}): string[] {
  fakeApi();
  const requests: string[] = [];
  const byDimension: Record<string, BreakdownResponse> = {
    project: response(projectRows),
    model: response(modelRows),
    ...fake.byDimension,
  };
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
    http.get("*/api/usage/breakdown", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const found = byDimension[url.searchParams.get("dimension") ?? ""];
      return found === undefined
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(found);
    }),
    http.get("*/api/usage/series", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return HttpResponse.json({ buckets: [], unpricedModels: [], note: ESTIMATE_NOTE });
    }),
    http.get("*/api/usage/projects", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const client = url.searchParams.get("client");
      const projects = fake.projects ?? projectList;
      return HttpResponse.json({
        projects: projects.filter(
          (project) => client === null || (project as { client: string }).client === client,
        ),
      });
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

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`No item at ${String(index)}`);
  return item;
}

const table = (name: string) => screen.findByRole("table", { name });
const bodyRows = (element: HTMLElement) => within(element).getAllByRole("row").slice(1);

describe("By Project", () => {
  it("lists the Projects by tokens with the share, client, figures and a totals row", async () => {
    fakeUsage();
    renderApp();
    const projects = await table("Usage by Project");
    const rows = bodyRows(projects);
    expect(rows.map((each) => within(each).getAllByRole("rowheader")[0]?.textContent)).toEqual([
      "payments-api",
      "foreman",
      "spike-cli",
      "Total",
    ]);
    const first = within(at(rows, 0)).getAllByRole("cell");
    expect(first.map((cell) => cell.textContent)).toEqual([
      "acme",
      "70%",
      "4M",
      "1M",
      "1M",
      "2M",
      "80",
      "$20.00",
    ]);
    const spike = within(at(rows, 2)).getAllByRole("cell");
    expect(spike[0]?.textContent).toBe("Unassigned");
    expect(spike[7]?.textContent).toBe("—");
    expect(
      within(projects)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Project",
      "Client",
      "Share",
      "Input",
      "Output",
      "Cache write",
      "Cache read",
      "Turns",
      "List-price estimate",
    ]);
  });

  it("shows no share for an unpriced row with the metric List-price estimate", async () => {
    window.history.replaceState(null, "", "/usage?metric=estimate");
    fakeUsage();
    renderApp();
    const rows = bodyRows(await table("Usage by Project"));
    expect(within(at(rows, 0)).getAllByRole("cell")[1]?.textContent).toBe("71%");
    expect(within(at(rows, 2)).getAllByRole("cell")[1]?.textContent).toBe("—");
  });
});

describe("a Project row opens the Project page", () => {
  it("links the Project with the same range, grain, metric and scope", async () => {
    window.history.replaceState(null, "", "/usage?range=30d&grain=week&metric=turns&client=acme");
    fakeUsage();
    renderApp();
    const link = await screen.findByRole("link", { name: "payments-api" });
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe(`/usage/projects/${PAYMENTS}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      range: "30d",
      grain: "week",
      metric: "turns",
      client: "acme",
    });
  });

  it("links no row of another tab", async () => {
    fakeUsage();
    renderApp();
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Model" }));
    const models = await table("Usage by Model");
    expect(within(models).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the tabs", () => {
  it("write the tab to the URL and Back undoes the change", async () => {
    fakeUsage();
    renderApp();
    const user = userEvent.setup();
    await table("Usage by Project");
    expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Model" }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("model");
    await table("Usage by Model");
    window.history.back();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute("aria-selected", "true");
    });
    await table("Usage by Project");
  });

  it("move with the arrow keys", async () => {
    fakeUsage();
    renderApp();
    const user = userEvent.setup();
    await table("Usage by Project");
    screen.getByRole("tab", { name: "Project" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Model" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
  });

  it("ask the API for 500 rows, and 25 for the tab Session", async () => {
    const requests = fakeUsage({ byDimension: { session: response([row("s1", "foreman")]) } });
    renderApp();
    const user = userEvent.setup();
    await table("Usage by Project");
    await user.click(screen.getByRole("tab", { name: "Session" }));
    await table("Usage by Session");
    expect(requests.some((each) => each.includes("dimension=project&limit=500"))).toBe(true);
    expect(requests.some((each) => each.includes("dimension=session&limit=25"))).toBe(true);
  });
});

describe("the tab Skill", () => {
  it("shows the calls, exact turns and estimated turns apart, with the note", async () => {
    window.history.replaceState(null, "", "/usage?tab=skill");
    fakeUsage({
      byDimension: {
        skill: response([
          row("factory-core:to-code", "factory-core:to-code", {
            calls: 4,
            exactTurns: 120,
            estimatedTurns: 30,
            turns: 150,
          }),
        ]),
      },
    });
    renderApp();
    const skills = await table("Usage by Skill");
    const headers = within(skills)
      .getAllByRole("columnheader")
      .map((each) => each.textContent);
    expect(headers.slice(-3)).toEqual(["Calls", "Exact turns", "Estimated turns"]);
    const cells = within(at(bodyRows(skills), 0)).getAllByRole("cell");
    expect(cells.slice(-3).map((cell) => cell.textContent)).toEqual(["4", "120", "30"]);
    expect(
      screen.getByText(
        "Estimated turns are an estimate: the turns of the main conversation from a skill call to your next message.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(ESTIMATE_NOTE).length).toBeGreaterThan(1);
  });
});

describe("the tab Session", () => {
  it("shows the Project label, the first and last turn time and the top 25 note", async () => {
    window.history.replaceState(null, "", "/usage?tab=session");
    const sessions = Array.from({ length: 25 }, (_, index) =>
      row(`session-${String(index)}`, "foreman", {
        firstTurnAt: "2026-11-14T08:05:00.000Z",
        lastTurnAt: "2026-11-14T09:30:00.000Z",
      }),
    );
    fakeUsage({ byDimension: { session: response(sessions, 40) } });
    renderApp();
    const list = await table("Usage by Session");
    expect(bodyRows(list)).toHaveLength(26);
    const headers = within(list)
      .getAllByRole("columnheader")
      .map((each) => each.textContent);
    expect(headers.slice(0, 3)).toEqual(["Project", "First turn", "Last turn"]);
    const cells = within(at(bodyRows(list), 0)).getAllByRole("cell");
    expect(cells[0]?.textContent).toBe("14 Nov 2026 08:05");
    expect(cells[1]?.textContent).toBe("14 Nov 2026 09:30");
    expect(
      screen.getByText("Top 25 of 40 sessions. The totals include all 40 sessions."),
    ).toBeInTheDocument();
  });

  it("shows the note for the other tabs in the form Top N of M by tokens", async () => {
    window.history.replaceState(null, "", "/usage?tab=model");
    fakeUsage({ byDimension: { model: response(modelRows, 640) } });
    renderApp();
    await table("Usage by Model");
    expect(screen.getByText("Top 3 of 640 by tokens")).toBeInTheDocument();
  });
});

describe("sort a table", () => {
  it("sorts by a header from high to low, then low to high, and keeps the totals row last", async () => {
    window.history.replaceState(null, "", "/usage?tab=model");
    fakeUsage();
    renderApp();
    const user = userEvent.setup();
    const models = await table("Usage by Model");
    const labels = () =>
      bodyRows(screen.getByRole("table", { name: "Usage by Model" })).map(
        (each) => within(each).getAllByRole("rowheader")[0]?.textContent,
      );
    expect(labels()).toEqual(["model-a", "model-b", "model-c", "Total"]);
    const header = () => within(models).getByRole("columnheader", { name: "Turns" });
    expect(header()).not.toHaveAttribute("aria-sort");
    await user.click(within(header()).getByRole("button", { name: "Turns" }));
    expect(header()).toHaveAttribute("aria-sort", "descending");
    expect(labels()).toEqual(["model-b", "model-c", "model-a", "Total"]);
    await user.click(within(header()).getByRole("button", { name: "Turns" }));
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    expect(labels()).toEqual(["model-a", "model-c", "model-b", "Total"]);
  });
});

describe("the Project page", () => {
  it("shows the Project and its client, the tabs without Project, and asks for that Project only", async () => {
    window.history.replaceState(null, "", `/usage/projects/${PAYMENTS}`);
    const requests = fakeUsage();
    renderApp();
    expect(
      await screen.findByRole("heading", { level: 1, name: /payments-api\s+acme/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Model",
      "Agent type",
      "Skill",
      "Branch",
      "Session",
    ]);
    expect(screen.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
    await table("Usage by Model");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("model");
    const usage = requests.filter((each) => each.includes("/api/usage/breakdown"));
    expect(usage.length).toBeGreaterThan(0);
    for (const each of usage) expect(each).toContain(`project=${PAYMENTS}`);
    expect(screen.queryByRole("link", { name: "payments-api" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
  });

  it("uses the default tab for a tab that the page does not have", async () => {
    window.history.replaceState(null, "", `/usage/projects/${PAYMENTS}?tab=project`);
    fakeUsage();
    renderApp();
    await table("Usage by Model");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("model");
    expect(
      screen.getByText(
        "The link has a value that is not valid. The page shows the defaults for it.",
      ),
    ).toBeInTheDocument();
  });

  it("links back to All Projects with the range", async () => {
    window.history.replaceState(null, "", `/usage/projects/${PAYMENTS}?range=30d&client=acme`);
    fakeUsage();
    renderApp();
    const link = await screen.findByRole("link", { name: "All Projects" });
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/usage");
    expect(url.searchParams.get("range")).toBe("30d");
    expect(url.searchParams.get("client")).toBe("acme");
  });
});

describe("a Project outside the scope", () => {
  it.each([
    ["a Project of another client", FOREMAN],
    ["a Project ID that matches no Project", "ffffffffffff"],
    ["a text that is not a Project ID", "not-an-id"],
  ])("shows the message and asks for no usage for %s", async (_name, id) => {
    window.history.replaceState(null, "", `/usage/projects/${id}?client=acme`);
    const requests = fakeUsage();
    renderApp();
    expect(await screen.findByText("No such Project in this scope.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(requests.some((each) => /usage\/(breakdown|series)/.test(each))).toBe(false);
  });
});
