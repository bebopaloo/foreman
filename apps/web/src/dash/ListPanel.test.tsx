import type { DashResponse, WorkItem, WorkItemsResponse } from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, quietDash, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const COUNTS = {
  all: 0,
  TODO: 0,
  READY: 0,
  "IN PROGRESS": 0,
  "IN REVIEW": 0,
  BLOCKED: 0,
  DONE: 0,
  CANCELLED: 0,
  none: 0,
};

const BASE_ISSUE = {
  number: 1,
  title: "Synthetic issue",
  state: "open",
  issueState: "BLOCKED",
  type: null,
  priority: "high",
  link: "https://github.com/acme/app/issues/1",
  stale: false,
} as const;

function at<T>(list: T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no row ${index.toString()}`);
  return value;
}

const issueRow = (number: number, over: Partial<WorkItem> = {}): WorkItem => ({
  repoId: "a1b2c3d4e5f6",
  fullName: "acme/app",
  client: "acme",
  issue: {
    number,
    title: `Synthetic issue ${number.toString()}`,
    state: "open",
    issueState: "BLOCKED",
    type: null,
    priority: "high",
    link: `https://github.com/acme/app/issues/${number.toString()}`,
    stale: false,
  },
  pullRequest: null,
  machineGate: null,
  round: null,
  riskTier: null,
  context: null,
  ...over,
});

const pullRow = (number: number, over: Partial<WorkItem> = {}): WorkItem => ({
  ...issueRow(number),
  issue: null,
  pullRequest: {
    number,
    title: `Synthetic pull request ${number.toString()}`,
    state: "open",
    draft: false,
    checks: "pass",
    link: `https://github.com/acme/app/pull/${number.toString()}`,
    stale: false,
    otherCount: 0,
  },
  ...over,
});

const response = (items: WorkItem[], over: Partial<WorkItemsResponse> = {}): WorkItemsResponse => ({
  state: "ok",
  items,
  nextCursor: null,
  counts: { ...COUNTS, all: items.length },
  complete: 0,
  noControlEvents: [],
  skipped: { controlEvents: 0, files: 0 },
  sources: { runs: "ok", controls: "ok" },
  events: null,
  ...over,
});

const lastRun = (runId: string, builds = 0): DashResponse["lastRun"] => ({
  runId,
  start: "2026-11-15T01:00:00.000Z",
  end: "2026-11-15T05:00:00.000Z",
  running: false,
  builds: [],
  lanes: 0,
  skips: 0,
  blockedAtSelection: 0,
  ...(builds < 0 ? {} : {}),
});

/** Fakes the dash and the Work items route. The returned list holds each items request as a search string. */
function setup(
  dash: Partial<DashResponse>,
  answer: (params: URLSearchParams) => WorkItemsResponse | Response = () => response([]),
) {
  const requests: string[] = [];
  fakeApi({ dash });
  server.use(
    http.get("*/api/work/items", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      const body = answer(url.searchParams);
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
  );
  return requests;
}

const panel = () => screen.findByRole("complementary");

const blockedDash: Partial<DashResponse> = {
  pipeline: {
    spec: 0,
    issues: 0,
    ready: 0,
    inProgress: 0,
    inReview: 0,
    blocked: 2,
    done: 230,
    release: 0,
  },
};

describe("a tile opens the List panel", () => {
  it("shows the heading, the count and the URL, and moves the focus", async () => {
    setup({ lastRun: lastRun("r1"), tiles: { builds: 6, peak: 3, merged: 1, waits: 0 } }, () =>
      response([1, 2, 3, 4, 5, 6].map((n) => issueRow(n))),
    );
    renderApp();
    const user = userEvent.setup();
    const tile = await screen.findByRole("button", { name: /Builds in the last run/ });
    expect(tile).toHaveAttribute("aria-expanded", "false");
    await user.click(tile);
    const aside = await panel();
    expect(within(aside).getByRole("heading", { name: "Builds in the last run" })).toHaveFocus();
    expect(await within(aside).findByText("6 items")).toBeInTheDocument();
    expect(window.location.search).toContain("panel=builds");
    expect(tile).toHaveAttribute("aria-expanded", "true");
  });

  it("asks for the run of the dash and links to the Work view", async () => {
    const requests = setup({
      lastRun: lastRun("r1"),
      tiles: { builds: 1, peak: 1, merged: 0, waits: 0 },
    });
    window.history.replaceState(null, "", "/?client=acme&panel=builds");
    renderApp();
    const aside = await panel();
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const params = new URLSearchParams(requests[0]);
    expect(params.get("set")).toBe("builds");
    expect(params.get("run")).toBe("r1");
    expect(params.get("client")).toBe("acme");
    expect(within(aside).getByRole("link", { name: "Open in the Work view" })).toHaveAttribute(
      "href",
      "/work?set=builds&run=r1&client=acme",
    );
  });

  it("shows build rows on two lines, and a build with no cache row without title or link", async () => {
    setup({ lastRun: lastRun("r1"), tiles: { builds: 2, peak: 1, merged: 1, waits: 0 } }, () =>
      response([
        issueRow(12, {
          context: {
            kind: "build",
            issue: 12,
            start: "2026-11-15T01:00:00.000Z",
            end: "2026-11-15T03:00:00.000Z",
            result: "merged",
          },
        }),
        {
          ...issueRow(7),
          repoId: null,
          fullName: "scratch",
          issue: null,
          context: {
            kind: "build",
            issue: 7,
            start: "2026-11-15T01:10:00.000Z",
            end: "2026-11-15T02:10:00.000Z",
            result: "blocked",
          },
        },
      ]),
    );
    window.history.replaceState(null, "", "/?panel=builds");
    renderApp();
    const aside = await panel();
    const rows = await within(aside).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("acme/app #12 Synthetic issue 12");
    expect(rows[0]).toHaveTextContent(/merged · .* to .* · 2 h 0 min/);
    expect(within(at(rows, 0)).getByRole("link", { name: "#12" })).toHaveAttribute(
      "href",
      "https://github.com/acme/app/issues/12",
    );
    expect(rows[1]).toHaveTextContent("scratch #7 not in the Work cache");
    expect(within(at(rows, 1)).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows issue titles as plain text", async () => {
    const hostile = '<img src="https://evil.test/x.png"> **bold** [a](https://evil.test)';
    setup(blockedDash, () => response([issueRow(1, { issue: { ...BASE_ISSUE, title: hostile } })]));
    window.history.replaceState(null, "", "/?panel=stage_blocked");
    renderApp();
    const aside = await panel();
    expect(await within(aside).findByText(hostile)).toBeInTheDocument();
    expect(aside.querySelector("img")).toBeNull();
  });
});

describe("states of the panel", () => {
  it("shows the error text when the request fails", async () => {
    setup(blockedDash, () => new Response(null, { status: 500 }));
    window.history.replaceState(null, "", "/?panel=stage_blocked");
    renderApp();
    const aside = await panel();
    expect(
      await within(aside).findByText(/The list cannot be read\. The API may be stopped/),
    ).toBeInTheDocument();
  });

  it("waits for the dash with no request, then shows the dash error", async () => {
    const requests = setup({});
    server.use(http.get("*/api/dash", () => new HttpResponse(null, { status: 500 })));
    window.history.replaceState(null, "", "/?panel=builds");
    renderApp();
    const aside = await panel();
    expect(await within(aside).findByText(/The list cannot be read/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("shows Reading the dash and asks for nothing before the dash data", async () => {
    const requests = setup({});
    server.use(http.get("*/api/dash", () => new Promise(() => undefined)));
    window.history.replaceState(null, "", "/?panel=builds");
    renderApp();
    const aside = await panel();
    expect(within(aside).getByText("Reading the dash.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("shows the text of an unreadable folder", async () => {
    setup(blockedDash, () => response([], { sources: { runs: "ok", controls: "unreadable" } }));
    window.history.replaceState(null, "", "/?panel=round_2");
    renderApp();
    const aside = await panel();
    expect(await within(aside).findByText("cannot read the factory folder")).toBeInTheDocument();
  });

  it("shows no builds for a run that is not in the window", async () => {
    setup({ lastRun: lastRun("r9") });
    window.history.replaceState(null, "", "/?panel=builds");
    renderApp();
    expect(await within(await panel()).findByText("No builds in this run.")).toBeInTheDocument();
  });

  it("shows No items in this scope for a stat with no items", async () => {
    setup({});
    window.history.replaceState(null, "", "/?panel=stage_g1");
    renderApp();
    expect(await within(await panel()).findByText("No items in this scope.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spec/ })).not.toBeInTheDocument();
  });

  it("shows the not connected text and the rows from the local files", async () => {
    setup({ pipeline: null, waits: null }, () => response([], { state: "not_connected" }));
    window.history.replaceState(null, "", "/?panel=waits");
    renderApp();
    expect(
      await within(await panel()).findByText(/Not connected\. Add the Foreman token/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Waits for you/ })).not.toBeInTheDocument();
  });

  it("shows a note for a panel value that is not valid, with no panel", async () => {
    setup({});
    window.history.replaceState(null, "", "/?client=acme&panel=stage_doing");
    renderApp();
    expect(
      await screen.findByText(/This link has a panel value that is not valid/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show the dash" })).toHaveAttribute(
      "href",
      "/?client=acme",
    );
  });

  it("does not make the build tiles buttons for a run ID of 201 characters", async () => {
    setup({
      lastRun: lastRun("x".repeat(201)),
      tiles: { builds: 3, peak: 1, merged: 1, waits: 0 },
    });
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    expect(
      screen.queryByRole("button", { name: /Builds in the last run/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Merged in the last run/ }),
    ).not.toBeInTheDocument();
  });
});

describe("opening and closing", () => {
  it("replaces the panel with a second stat, and closes it with the same stat", async () => {
    setup({
      ...blockedDash,
      tiles: { builds: 1, peak: 1, merged: 0, waits: 0 },
      lastRun: lastRun("r1"),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Builds in the last run/ }));
    await user.click(await screen.findByRole("button", { name: /BLOCKED/ }));
    expect(window.location.search).toContain("panel=stage_blocked");
    expect(await screen.findByRole("heading", { name: "BLOCKED", level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /BLOCKED/ }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("panel");
  });

  it("closes with the X button and with Escape, and returns the focus to the stat", async () => {
    setup(blockedDash);
    renderApp();
    const user = userEvent.setup();
    const stat = await screen.findByRole("button", { name: /BLOCKED/ });
    await user.click(stat);
    await user.click(await screen.findByRole("button", { name: "Close the list" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(stat).toHaveFocus();
    await user.click(stat);
    await panel();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("panel");
    expect(stat).toHaveFocus();
  });

  it("opens the Waits for you panel from and N more", async () => {
    setup({
      waits: { total: 30, items: [] },
      tiles: { builds: null, peak: null, merged: null, waits: 30 },
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "and 30 more" }));
    expect(window.location.search).toContain("panel=waits");
    expect(
      within(await panel()).getByRole("heading", { name: "Waits for you" }),
    ).toBeInTheDocument();
  });

  it("goes back from a panel to the URL before", async () => {
    setup(blockedDash);
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /BLOCKED/ }));
    await panel();
    window.history.back();
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    });
  });
});

describe("rows of the other sets", () => {
  it("shows a wait with its reason and source", async () => {
    setup(
      {
        waits: { total: 1, items: [] },
        tiles: { builds: null, peak: null, merged: null, waits: 1 },
      },
      () =>
        response([
          issueRow(50, {
            context: {
              kind: "wait",
              wait: "blocked",
              reason: "auto mode refused",
              source: "night log",
            },
          }),
        ]),
    );
    window.history.replaceState(null, "", "/?panel=waits");
    renderApp();
    const rows = await within(await panel()).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("auto mode refused · source: night log");
  });

  it("shows the Escalations heading and the tiers of each event", async () => {
    setup({ reviewHealth: { ...quietDash.reviewHealth, escalations: 3 } }, () =>
      response(
        [
          pullRow(40, {
            context: {
              kind: "review",
              pullRequest: 40,
              link: "https://github.com/acme/app/pull/40",
              detail: {
                type: "escalations",
                events: [
                  { pathTier: "general", finalTier: "sensitive" },
                  { pathTier: "sensitive", finalTier: "authority" },
                ],
              },
            },
          }),
          pullRow(41, {
            context: {
              kind: "review",
              pullRequest: 41,
              link: null,
              detail: { type: "escalations", events: [{ pathTier: null, finalTier: "inert" }] },
            },
          }),
        ],
        { events: 3 },
      ),
    );
    window.history.replaceState(null, "", "/?panel=escalated");
    renderApp();
    const aside = await panel();
    expect(
      await within(aside).findByRole("heading", { name: "3 Escalations on 2 pull requests" }),
    ).toBeInTheDocument();
    expect(within(aside).getAllByRole("listitem")[0]).toHaveTextContent(
      "general → sensitive, sensitive → authority",
    );
  });

  it("shows Waiver IDs, a decision, a round and a pull request with no cache row", async () => {
    const review = (
      pr: number,
      detail: Extract<WorkItem["context"], { kind: "review" }>["detail"],
    ) => ({ kind: "review", pullRequest: pr, link: null, detail }) as const;
    setup({}, () =>
      response([
        pullRow(4, { context: review(4, { type: "waivers", ids: ["W-1", "W-2"] }) }),
        pullRow(5, { context: review(5, { type: "decision", decision: "fail" }) }),
        pullRow(6, { context: review(6, { type: "round", round: 2 }) }),
        {
          ...pullRow(12),
          pullRequest: null,
          context: review(12, { type: "decision", decision: "pass" }),
        },
      ]),
    );
    window.history.replaceState(null, "", "/?panel=waivers");
    renderApp();
    const rows = await within(await panel()).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("W-1, W-2");
    expect(rows[1]).toHaveTextContent("PR #5 · fail");
    expect(rows[2]).toHaveTextContent("round 2");
    expect(rows[3]).toHaveTextContent("acme/app PR #12 not in the Work cache");
    expect(within(at(rows, 3)).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the pull request and the gate of a stage row", async () => {
    setup(blockedDash, () =>
      response([
        issueRow(1, {
          pullRequest: pullRow(40).pullRequest,
          machineGate: { source: "events", value: "pass" },
        }),
      ]),
    );
    window.history.replaceState(null, "", "/?panel=stage_blocked");
    renderApp();
    const rows = await within(await panel()).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("BLOCKED · high · PR #40 checks pass · gate pass (event)");
  });

  it("shows more rows with Show more", async () => {
    setup(blockedDash, (params) =>
      params.get("cursor") === null
        ? response([issueRow(1), issueRow(2)], {
            nextCursor: "next",
            counts: { ...COUNTS, all: 3 },
          })
        : response([issueRow(3)], { counts: { ...COUNTS, all: 3 } }),
    );
    window.history.replaceState(null, "", "/?panel=stage_done");
    renderApp();
    const user = userEvent.setup();
    const aside = await panel();
    expect(await within(aside).findByText("3 items")).toBeInTheDocument();
    await user.click(await within(aside).findByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(aside).getAllByRole("listitem")).toHaveLength(3);
    });
  });
});

describe("live update of the panel", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    setVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("asks again after 60 seconds in a visible tab, and not in a hidden tab", async () => {
    const requests = setup(blockedDash);
    window.history.replaceState(null, "", "/?panel=stage_blocked");
    renderApp();
    await panel();
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(2);
  });
});
