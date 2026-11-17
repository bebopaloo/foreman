import type {
  ReviewsPullRequest,
  ReviewsPullRequestsResponse,
  ReviewsResponse,
} from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const APP = "0123456789ab";

const zeroRow = { total: 0 };

function reviews(over: Partial<ReviewsResponse> = {}): ReviewsResponse {
  return {
    tiles: {
      pullRequestsReviewed: { count: 10 },
      firstRoundPass: { percent: 70, passed: 7, total: 10 },
      escalationRate: { percent: 25, escalated: 2, withTier: 8 },
      reviewShare: { percent: 40, builds: 4 },
    },
    tierResults: {
      byFinalTier: { authority: 1, sensitive: 5, general: 2, inert: 0, none: 2 },
      pathAgainstFinal: {
        cells: [
          { pathTier: "general", finalTier: "authority", count: 1, escalated: true },
          { pathTier: "sensitive", finalTier: "sensitive", count: 5, escalated: false },
        ],
        noTier: 2,
      },
      merges: [
        { base: "main", authority: 0, sensitive: 0, general: 3, inert: 0, none: 1 },
        { base: "feature/*", authority: 2, sensitive: 0, general: 0, inert: 0, none: 0 },
      ],
    },
    rounds: [
      {
        tier: "sensitive",
        pullRequests: 5,
        settledInRound: [1, 1, 0],
        blocked: 1,
        notSettled: 2,
        withDecision: 4,
        lastGatePassPercent: 50,
      },
    ],
    findings: {
      mode: "round1",
      security: {
        bySeverity: {
          blocker: zeroRow,
          major: { sensitive: 1, total: 1 },
          minor: { sensitive: 2, total: 2 },
          info: zeroRow,
        },
        withoutMatrix: 3,
      },
      byCategory: [
        { name: "Correctness", count: 2 },
        { name: "Security", count: 1 },
      ],
      bySeverity: [{ name: "major", count: 2 }],
      refs: [
        { ref: "CWE-639", pullRequests: 3 },
        { ref: '<img src="https://evil.example/t.png">', pullRequests: 1 },
      ],
      refsMore: 3,
      signals: [
        {
          repoId: APP,
          repo: "acme/app",
          pr: 46,
          tier: "general",
          blocker: 0,
          major: 0,
          minor: 1,
          link: "https://github.com/acme/app/pull/46",
        },
        {
          repoId: null,
          repo: "app",
          pr: 50,
          tier: "inert",
          blocker: 0,
          major: 1,
          minor: 1,
          link: null,
        },
      ],
      signalsMore: 0,
    },
    times: {
      byTier: [
        {
          tier: "sensitive",
          pullRequests: 3,
          timed: 3,
          medianBuildSeconds: 2400,
          medianReviewCycleSeconds: 3000,
          meanRounds: 1.5,
          reviewSharePercent: 54,
        },
      ],
      noBuildEnd: 0,
      notTimed: 1,
      noPullRequest: 1,
      reviewAgentSpansNotLinked: 2,
      usageDataAsOf: "2026-11-15T06:00:00.000Z",
    },
    factoryLoginSet: true,
    eventsOff: [],
    skipped: { nightLogLines: 0, controlEvents: 0, files: 0 },
    complete: 0,
    state: "ok",
    ...over,
  };
}

function row(over: Partial<ReviewsPullRequest> = {}): ReviewsPullRequest {
  return {
    repoId: APP,
    repo: "acme/app",
    number: 40,
    issue: 12,
    finalTier: "authority",
    pathTier: "general",
    escalated: true,
    rounds: 2,
    outcome: "pass",
    buildSeconds: 2100,
    buildEndSource: "agent span",
    reviewCycleSeconds: 3300,
    split: { reviewAgentsSeconds: 1200, resolverSeconds: 600, otherSeconds: 1500 },
    totalSeconds: 5400,
    link: "https://github.com/acme/app/pull/40",
    ...over,
  };
}

interface Served {
  document?: ReviewsResponse;
  pages?: ReviewsPullRequest[][];
}

/** Each request to the Reviews routes, as path and query. */
const requests: string[] = [];

function serve({ document = reviews(), pages = [[row()]] }: Served = {}) {
  requests.length = 0;
  fakeApi();
  server.use(
    http.get("*/api/usage/status", () =>
      HttpResponse.json({
        state: "idle",
        reason: null,
        filesRead: null,
        filesTotal: null,
        dataAsOf: "2026-11-15T06:00:00.000Z",
      }),
    ),
    http.get("*/api/reviews", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return HttpResponse.json({
        ...document,
        findings: { ...document.findings, mode: url.searchParams.get("mode") ?? "round1" },
      });
    }),
    http.get("*/api/reviews/findings", () =>
      HttpResponse.json({
        folder: "missing",
        skippedLines: 0,
        skippedFiles: 0,
        security: { bySeverity: {} },
        repos: [],
        passes: [],
        total: 0,
        items: [],
        nextCursor: null,
      }),
    ),
    http.get("*/api/reviews/pull-requests", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const cursor = url.searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor);
      const body: ReviewsPullRequestsResponse = {
        items: pages[index] ?? [],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      };
      return HttpResponse.json(body);
    }),
  );
}

function at(items: HTMLElement[], index: number): HTMLElement {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at ${index.toString()}`);
  return item;
}

function open(path = "/reviews") {
  window.history.replaceState(null, "", path);
}

describe("the Reviews page", () => {
  it("shows the four tiles, then the five sections in order", async () => {
    open();
    serve();
    renderApp();
    const tiles = await screen.findByRole("list", { name: "Tiles" });
    const text = (tile: string) => within(tiles).getByText(tile).closest("li")?.textContent ?? "";
    expect(text("Pull requests reviewed")).toBe("Pull requests reviewed10last 30 days");
    expect(text("First-round pass")).toBe("First-round pass70%of 10 pull requests");
    expect(text("Escalation rate")).toBe("Escalation rate25%of 8 pull requests with a tier");
    expect(text("Review share of total time")).toBe("Review share of total time40%of 4 builds");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Risk tier results",
      "Rounds to settle, by final tier",
      "Security findings",
      "Findings ledger",
      "Review time against build time",
    ]);
    expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the tiles with no data as a dash and the reason, and the sections as empty", async () => {
    open();
    serve({
      document: reviews({
        tiles: {
          pullRequestsReviewed: { count: 0 },
          firstRoundPass: { percent: null, passed: 0, total: 0 },
          escalationRate: { percent: null, escalated: 0, withTier: 0 },
          reviewShare: { percent: null, builds: 0 },
        },
        tierResults: {
          byFinalTier: { authority: 0, sensitive: 0, general: 0, inert: 0, none: 0 },
          pathAgainstFinal: { cells: [], noTier: 0 },
          merges: [],
        },
        rounds: [],
        times: { ...reviews().times, byTier: [] },
      }),
      pages: [[]],
    });
    renderApp();
    const tiles = await screen.findByRole("list", { name: "Tiles" });
    expect(within(tiles).getByText("no gate decision in 30 days")).toBeInTheDocument();
    expect(within(tiles).getByText("no tier in 30 days")).toBeInTheDocument();
    expect(within(tiles).getByText("no timed build in 30 days")).toBeInTheDocument();
    expect(screen.getAllByText("No Control events in this scope.")).toHaveLength(3);
  });

  it("shows the path against final tier table with the escalated label and the no tier note", async () => {
    open();
    serve();
    renderApp();
    const table = await screen.findByRole("table", { name: "Path tier against final tier" });
    const general = within(table).getByRole("row", { name: /^general/ });
    const cells = within(general).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["1escalated", "0", "0", "0"]);
    const sensitive = within(table).getByRole("row", { name: /^sensitive/ });
    expect(within(sensitive).getAllByRole("cell")[1]).toHaveTextContent("5");
    expect(within(sensitive).getAllByRole("cell")[1]).not.toHaveTextContent("escalated");
    expect(screen.getByText("2 pull requests with no tier")).toBeInTheDocument();
    expect(
      screen.getByText(/A path that escalates again and again shows a wrong Risk map/),
    ).toBeInTheDocument();
  });

  it("gives the bars of the final tiers a table for a screen reader", async () => {
    open();
    serve();
    renderApp();
    const table = await screen.findByRole("table", { name: "Pull requests by final tier" });
    expect(within(table).getByRole("row", { name: /^no tier/ })).toHaveTextContent("2");
    expect(within(table).getByRole("columnheader", { name: "Final tier" })).toBeInTheDocument();
  });

  it("shows merges by base and tier", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Merges by base and tier" });
    const items = within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["main: general 3, no tier 1", "feature/*: authority 2"]);
  });

  it("shows the rounds to settle of a tier as text", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Rounds to settle by final tier" });
    expect(list).toHaveTextContent(
      "sensitive · 5 pull requestsround 1: 1 · round 2: 1 · round 3: 0 · BLOCKED: 1 · not settled: 2last-gate pass: 50% of 4",
    );
  });

  it("shows the Security table, and the mode buttons set mode in the URL and ask again", async () => {
    open();
    serve();
    renderApp();
    const user = userEvent.setup();
    const table = await screen.findByRole("table", {
      name: "Security findings by severity and Risk tier",
    });
    const major = within(table).getByRole("row", { name: /^major/ });
    expect(
      within(major)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["0", "1", "0", "0", "1"]);
    expect(screen.getByText("3 pull requests with no matrix: not counted")).toBeInTheDocument();
    const round1 = screen.getByRole("button", { name: "Found in round 1" });
    expect(round1).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Left at settle" }));
    expect(window.location.search).toBe("?mode=settle");
    await waitFor(() => {
      expect(requests).toContain("/api/reviews?mode=settle");
    });
    expect(screen.getByRole("button", { name: "Left at settle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Found in round 1" }));
    expect(window.location.search).toBe("");
  });

  it("opens with mode=settle from the URL", async () => {
    open("/reviews?mode=settle");
    serve();
    renderApp();
    expect(await screen.findByRole("button", { name: "Left at settle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(requests[0]).toBe("/api/reviews?mode=settle");
  });

  it("shows a mode value that is not valid as the default with a note", async () => {
    open("/reviews?mode=other");
    serve();
    renderApp();
    expect(await screen.findByText(/The link has a mode value that is not valid/)).toBeVisible();
    await waitFor(() => {
      expect(requests[0]).toBe("/api/reviews?mode=round1");
    });
  });

  it("shows refs as plain text with 'and N more', and no image", async () => {
    open();
    serve();
    const { container } = renderApp();
    const list = await screen.findByRole("list", { name: "Most frequent refs" });
    expect(within(list).getByText('<img src="https://evil.example/t.png">')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(within(list).getByText("3 pull requests")).toBeInTheDocument();
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  it("shows the signals with the link from the cache only", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Signals" });
    const items = within(list).getAllByRole("listitem");
    const first = at(items, 0);
    const second = at(items, 1);
    expect(first).toHaveTextContent("acme/app #46");
    expect(first).toHaveTextContent("general · 1 minor Security finding");
    const link = within(first).getByRole("link");
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/pull/46");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(second).toHaveTextContent("inert · 1 major, 1 minor Security findings");
    expect(within(second).queryByRole("link")).toBeNull();
  });

  it("does not make a link of an address that is not a web address", async () => {
    open();
    serve({ pages: [[row({ link: "javascript:alert(1)" })]] });
    renderApp();
    const list = await screen.findByRole("list", { name: "Pull requests" });
    expect(within(list).queryByRole("link")).toBeNull();
  });

  it("shows the row of a pull request with the build end source and the split in text", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Pull requests" });
    const item = within(list).getByRole("listitem");
    expect(item).toHaveTextContent("acme/app #40");
    expect(item).toHaveTextContent("authority · escalated from general · 2 rounds, passed");
    expect(item).toHaveTextContent(
      "build 35 min · review agents 20 min · resolver 10 min · other 25 min · total 1 h 30 min · build end: agent span",
    );
    expect(
      within(item).getByRole("link", { name: /Pull request 40 of acme\/app/ }),
    ).toHaveAttribute("href", "https://github.com/acme/app/pull/40");
  });

  it("shows a build with no build end, no tier and unknown rounds", async () => {
    open();
    serve({
      pages: [
        [
          row({
            number: 7,
            finalTier: null,
            pathTier: null,
            escalated: false,
            rounds: null,
            outcome: null,
            buildSeconds: null,
            buildEndSource: null,
            reviewCycleSeconds: null,
            split: null,
            totalSeconds: 600,
            link: null,
          }),
        ],
      ],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Pull requests" });
    expect(list).toHaveTextContent("no tier · rounds unknown");
    expect(list).toHaveTextContent("no build end · total 10 min");
    expect(within(list).queryByRole("link")).toBeNull();
  });

  it("shows the counts of the builds that the section leaves out", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Builds that the section leaves out" });
    expect(list).toHaveTextContent("1 build not timed: its start or its settle is in another run");
    expect(list).toHaveTextContent("1 build with no pull request");
    expect(list).toHaveTextContent("2 review agent spans not linked: no single work item");
    expect(await screen.findByText(/Usage data as of/)).toBeInTheDocument();
  });

  it("shows the table of times by tier in whole minutes", async () => {
    open();
    serve();
    renderApp();
    const table = await screen.findByRole("table", {
      name: "Review time against build time, by final tier",
    });
    const cells = within(within(table).getByRole("row", { name: /^sensitive/ }))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells).toEqual(["3", "3", "40 min", "50 min", "1.5", "54%"]);
  });

  it("shows Show more for the next page of pull requests", async () => {
    open();
    serve({ pages: [[row()], [row({ number: 41 })]] });
    renderApp();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "Pull requests" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows the Control events off note and the Factory identity counts", async () => {
    open();
    serve({
      document: reviews({
        eventsOff: [
          {
            repoId: "aaaaaaaaaaaa",
            repo: "globex/portal",
            reason: "module_off",
            reviewed: 3,
            unreviewed: 1,
          },
          {
            repoId: "bbbbbbbbbbbb",
            repo: "globex/api",
            reason: "no_events",
            reviewed: null,
            unreviewed: null,
          },
        ],
      }),
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Repos with no Control events" });
    const [off, none] = within(list).getAllByRole("listitem");
    expect(off).toHaveTextContent(
      "Control events are off in globex/portal. Its pull requests show only in Review time against build time, from the night log and the Usage index.",
    );
    expect(off).toHaveTextContent("3 factory pull requests reviewed by the Factory identity");
    expect(none).toHaveTextContent("globex/api: no Control events in 30 days");
  });

  it("says that the Factory identity login is not set", async () => {
    open();
    serve({
      document: reviews({
        factoryLoginSet: false,
        eventsOff: [
          {
            repoId: "bbbbbbbbbbbb",
            repo: "globex/api",
            reason: "no_events",
            reviewed: null,
            unreviewed: null,
          },
        ],
      }),
    });
    renderApp();
    expect(await screen.findByText(/Factory identity login not set/)).toBeInTheDocument();
  });

  it("shows Data is not complete above the signals and the pull requests", async () => {
    open();
    serve({ document: reviews({ complete: 1 }) });
    renderApp();
    await screen.findByRole("list", { name: "Signals" });
    const notes = screen.getAllByText(/Data is not complete: 1 repo not connected\./);
    expect(notes).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Repos" })[0]).toHaveAttribute(
      "href",
      "/#dash-repos",
    );
  });

  it("shows Not connected above the signals and the pull requests, and keeps the numbers", async () => {
    open();
    serve({ document: reviews({ state: "not_connected" }), pages: [[row({ link: null })]] });
    renderApp();
    await screen.findByRole("list", { name: "Signals" });
    expect(
      screen.getAllByText(/Not connected\. Add the Foreman token to the Keychain/),
    ).toHaveLength(2);
    expect(screen.getByText("Pull requests reviewed")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("asks for a client scope in the requests", async () => {
    open("/reviews?client=acme");
    serve();
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    expect(requests).toContain("/api/reviews?mode=round1&client=acme");
    expect(requests).toContain("/api/reviews/pull-requests?client=acme");
  });

  it("shows an error when the data cannot be read", async () => {
    open();
    serve();
    server.use(http.get("*/api/reviews", () => new HttpResponse(null, { status: 500 })));
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("The review data cannot be read");
  });
});

describe("live update", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    setVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("asks again for the data and the list each 60 seconds, and not in a hidden tab", async () => {
    open();
    serve();
    renderApp();
    await screen.findByRole("list", { name: "Pull requests" });
    const before = requests.length;
    expect(before).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(before + 2);
    });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(before + 2);
  });
});
