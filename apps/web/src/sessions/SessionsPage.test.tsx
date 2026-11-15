import type {
  RefreshStatusResponse,
  SessionResponse,
  SessionsResponse,
  SessionSpan,
  SessionSummary,
} from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const PROJECT = { id: "0123456789ab", label: "acme/app" };

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1abcdef12345",
    name: "factory-core:factory-run",
    kind: "unattended-loop",
    start: "2026-11-14T09:00:00.000Z",
    end: "2026-11-14T09:50:00.000Z",
    continuesBefore: false,
    continuesAfter: false,
    projects: [PROJECT],
    projectCount: 1,
    tokens: 5340,
    turns: 12,
    userMessages: 3,
    ...overrides,
  };
}

function span(overrides: Partial<SessionSpan> = {}): SessionSpan {
  return {
    key: "a:agent-1",
    kind: "sub-agent",
    agentType: "software-developer",
    skill: "to-code",
    skillBasis: "exact",
    models: [
      { model: "claude-sonnet-4-5", turns: 6 },
      { model: "claude-opus-4-1 (fast)", turns: 1 },
    ],
    project: PROJECT,
    workItem: { kind: "none" },
    start: "2026-11-14T09:08:00.000Z",
    end: "2026-11-14T09:40:00.000Z",
    turns: 7,
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 1,
    cacheReadTokens: 1,
    tokens: 5340,
    ...overrides,
  };
}

interface Served {
  sessions?: SessionSummary[];
  /** Pages of the list: each entry is the sessions of one page. */
  listPages?: SessionSummary[][];
  spans?: SessionSpan[];
  userMessages?: string[];
  complete?: SessionResponse["complete"];
  /** The session IDs that exist. With none, the route answers 404 for the unknown ones. */
  known?: string[];
  usageStatus?: RefreshStatusResponse;
}

const idleStatus: RefreshStatusResponse = {
  state: "idle",
  reason: null,
  filesRead: null,
  filesTotal: null,
  dataAsOf: "2026-11-15T06:00:00.000Z",
};

/** Each request to the sessions routes, as path and query. */
const requests: string[] = [];

function serve(options: Served = {}) {
  requests.length = 0;
  const sessions = options.sessions ?? [summary()];
  const pages = options.listPages ?? [sessions];
  const spans = options.spans ?? [span()];
  fakeApi();
  server.use(
    http.get("*/api/usage/status", () => HttpResponse.json(options.usageStatus ?? idleStatus)),
    http.get("*/api/sessions", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const cursor = url.searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor);
      const page = pages[index] ?? [];
      const body: SessionsResponse = {
        sessions: page,
        total: pages.flat().length,
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      };
      return HttpResponse.json(body);
    }),
    http.get("*/api/sessions/:sessionId", ({ request, params }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const id = String(params.sessionId);
      const known = options.known ?? pages.flat().map((entry) => entry.id);
      if (!known.includes(id)) {
        return HttpResponse.json({ error: "Not found", requestId: "r1" }, { status: 404 });
      }
      const found = pages.flat().find((entry) => entry.id === id) ?? summary({ id });
      const body: SessionResponse = {
        session: found,
        window: { start: found.start, end: found.end },
        userMessages: options.userMessages ?? [],
        userMessageTotal: options.userMessages?.length ?? 0,
        spans,
        spanTotal: spans.length,
        nextCursor: null,
        complete: options.complete ?? { incompleteRepos: 0, notConnected: false },
      };
      return HttpResponse.json(body);
    }),
  );
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at ${index.toString()}`);
  return item;
}

async function spanRows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole("list", { name: "Spans of the session" });
  return within(list).findAllByRole("listitem");
}

function openPage(path: string, timeZone = "Europe/London") {
  process.env.TZ = timeZone;
  window.history.replaceState(null, "", path);
  return renderApp();
}

const originalTz = process.env.TZ;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("today by default", () => {
  it("asks for today in the time zone of the browser and shows the heading", async () => {
    serve();
    openPage("/sessions");
    expect(await screen.findByRole("heading", { level: 1, name: "Sessions today" })).toBeVisible();
    await waitFor(() => {
      expect(requests).toContain("/api/sessions?day=2026-11-15&tz=Europe%2FLondon");
    });
  });

  it("shows the date for an earlier day", async () => {
    serve();
    openPage("/sessions?day=2026-11-13");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sessions on 13 Nov 2026" }),
    ).toBeVisible();
  });

  it("disables Next day on today and does not offer a later day", async () => {
    serve();
    openPage("/sessions");
    expect(await screen.findByRole("button", { name: "Next day" })).toBeDisabled();
    expect(screen.getByLabelText("Day")).toHaveAttribute("max", "2026-11-15");
  });

  it("moves to the day before and the day after, and keeps the client", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve();
    openPage("/sessions?client=acme");
    await user.click(await screen.findByRole("button", { name: "Previous day" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sessions on 14 Nov 2026" }),
    ).toBeVisible();
    expect(window.location.search).toContain("day=2026-11-14");
    expect(window.location.search).toContain("client=acme");
    expect(screen.getByRole("button", { name: "Next day" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sessions today" })).toBeVisible();
  });
});

describe("a day in the time zone of the browser", () => {
  it("shows the times in that zone", async () => {
    serve({
      sessions: [summary({ start: "2026-11-14T23:30:00.000Z", end: "2026-11-14T23:50:00.000Z" })],
    });
    openPage("/sessions?day=2026-11-15", "Europe/Berlin");
    const list = await screen.findByRole("list", { name: "Sessions of the day" });
    expect(await within(list).findByText(/00:30 to 00:50/)).toBeVisible();
    await waitFor(() => {
      expect(requests).toContain("/api/sessions?day=2026-11-15&tz=Europe%2FBerlin");
    });
  });
});

describe("the session list", () => {
  it("shows the name, the short ID, the kind, the Projects, the tokens and the messages", async () => {
    serve({
      sessions: [
        summary({
          projects: [PROJECT],
          projectCount: 3,
          continuesBefore: true,
          continuesAfter: true,
        }),
        summary({ id: "s2", name: null, kind: "session", userMessages: 1, tokens: 1_940_000 }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const list = await screen.findByRole("list", { name: "Sessions of the day" });
    const [first, second] = await within(list).findAllByRole("link");
    expect(first).toHaveTextContent("factory-core:factory-run s1abcdef");
    expect(first).toHaveTextContent("Unattended loop · 09:00 to 09:50");
    expect(first).toHaveTextContent("acme/app +2 · 5.3K tokens");
    expect(first).toHaveTextContent("3 messages from you");
    expect(first).toHaveTextContent("continues from the day before");
    expect(first).toHaveTextContent("continues on the next day");
    expect(second).toHaveTextContent("No skill s2");
    expect(second).toHaveTextContent("Session ·");
    expect(second).toHaveTextContent("1.9M tokens");
    expect(second).toHaveTextContent("1 message from you");
  });

  it("selects the first session, marks it, and keeps the day and client in the links", async () => {
    serve({ sessions: [summary({ id: "s1" }), summary({ id: "s2", name: "to-code" })] });
    openPage("/sessions?day=2026-11-14&client=acme");
    const list = await screen.findByRole("list", { name: "Sessions of the day" });
    const links = await within(list).findAllByRole("link");
    expect(links[0]).toHaveAttribute("aria-current", "true");
    expect(links[1]).not.toHaveAttribute("aria-current");
    expect(links[1]).toHaveAttribute("href", "/sessions?day=2026-11-14&session=s2&client=acme");
    await waitFor(() => {
      expect(requests.some((request) => request.startsWith("/api/sessions/s1?"))).toBe(true);
    });
  });

  it("selects a session when its link is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve({ sessions: [summary({ id: "s1" }), summary({ id: "s2", name: "to-code" })] });
    openPage("/sessions?day=2026-11-14");
    const list = await screen.findByRole("list", { name: "Sessions of the day" });
    await user.click(at(await within(list).findAllByRole("link"), 1));
    await waitFor(() => {
      expect(window.location.search).toContain("session=s2");
    });
    expect(
      await screen.findByRole("heading", { level: 2, name: /^to-code · 09:00 to 09:50/ }),
    ).toBeVisible();
    expect((await within(list).findAllByRole("link"))[1]).toHaveAttribute("aria-current", "true");
  });

  it("loads the next page with Show more sessions", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve({
      listPages: [[summary({ id: "s1" })], [summary({ id: "s2", name: "to-code" })]],
    });
    openPage("/sessions?day=2026-11-14");
    await user.click(await screen.findByRole("button", { name: "Show more sessions" }));
    const list = screen.getByRole("list", { name: "Sessions of the day" });
    await waitFor(() => {
      expect(within(list).getAllByRole("link")).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Show more sessions" })).not.toBeInTheDocument();
  });

  it("shows a message when the day has no session", async () => {
    serve({ sessions: [] });
    openPage("/sessions?day=2026-11-12");
    expect(await screen.findByText("No sessions on this day in this scope.")).toBeVisible();
  });

  it("shows the message for a session that does not exist, and the list of the day", async () => {
    serve();
    openPage("/sessions?day=2026-11-14&session=s9");
    expect(await screen.findByText("No session s9 on this day in this scope.")).toBeVisible();
    expect(screen.getByRole("list", { name: "Sessions of the day" })).toBeVisible();
  });

  it("shows no data for a day that is not a date", async () => {
    serve();
    openPage("/sessions?day=2026-02-30");
    expect(await screen.findByText("Not a valid day.")).toBeVisible();
    await screen.findByText(/Usage data as of/);
    expect(requests).toEqual([]);
  });
});

describe("the timeline", () => {
  it("shows the spans with the Agent type, the skill, the models and the tokens", async () => {
    serve({
      spans: [
        span(),
        span({
          key: "m:1",
          kind: "main",
          agentType: "main",
          skill: "review-spec",
          skillBasis: "estimate",
          tokens: 812,
          models: [{ model: "claude-sonnet-4-5", turns: 2 }],
        }),
        span({ key: "a:2", agentType: "sub-agent (unknown)", skill: null, skillBasis: null }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const rows = within(
      await screen.findByRole("list", { name: "Spans of the session" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("software-developer · to-code");
    expect(rows[0]).toHaveTextContent("claude-sonnet-4-5 (6), claude-opus-4-1 (fast) (1)");
    expect(rows[0]).toHaveTextContent("5.3K");
    expect(rows[1]).toHaveTextContent("main · review-spec (estimate)");
    expect(rows[1]).toHaveTextContent("812");
    expect(rows[2]).toHaveTextContent("sub-agent (unknown)");
  });

  it("shows the heading, the kind and the note about metadata", async () => {
    serve();
    openPage("/sessions?day=2026-11-14");
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "factory-core:factory-run · 09:00 to 09:50",
      }),
    ).toBeVisible();
    expect(screen.getByText(/^Metadata only\./)).toBeVisible();
    expect(
      screen.getByText(/Skill attribution for main-conversation turns is an estimate/),
    ).toBeVisible();
  });

  it("shows one mark for each message from the Operator on the You lane", async () => {
    serve({
      userMessages: [
        "2026-11-14T09:01:00.000Z",
        "2026-11-14T09:10:00.000Z",
        "2026-11-14T09:30:00.000Z",
      ],
    });
    const { container } = openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    expect(container.querySelectorAll(".you-mark")).toHaveLength(3);
    expect(screen.getByText("You")).toBeVisible();
  });

  it("gives a table to screen readers with the full token counts", async () => {
    serve({
      spans: [
        span({ tokens: 812 }),
        span({ key: "a:2", tokens: 5340 }),
        span({ key: "a:3", tokens: 1_940_000 }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const table = await screen.findByRole("table");
    const cells = within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells).toContain("812");
    expect(cells).toContain("5,340");
    expect(cells).toContain("1,940,000");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Agent type", "Skill", "Start", "End", "Models", "Work item", "Turns", "Tokens"]);
    const rows = within(screen.getByRole("list", { name: "Spans of the session" })).getAllByRole(
      "listitem",
    );
    expect(rows[0]).toHaveTextContent("812");
    expect(rows[1]).toHaveTextContent("5.3K");
    expect(rows[2]).toHaveTextContent("1.9M");
  });

  it("hides the graphic from screen readers and lists the Agent types in a legend", async () => {
    serve({ spans: [span(), span({ key: "m:1", kind: "main", agentType: "main", skill: null })] });
    const { container } = openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    for (const bar of container.querySelectorAll(".span-bar")) {
      expect(bar.closest("[aria-hidden='true']")).not.toBeNull();
    }
    const legend = screen.getByRole("list", { name: "Agent types" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["software-developer", "main"]);
  });

  it("colours a known Agent type and every other one with the neutral colour", async () => {
    serve({
      spans: [
        span({ key: "a:1", agentType: "review-finder" }),
        span({ key: "a:2", agentType: "code-explorer" }),
      ],
    });
    const { container } = openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    const bars = [...container.querySelectorAll(".span-bar")];
    expect(bars[0]).toHaveClass("agent-review-finder");
    expect(bars[1]).toHaveClass("agent-other");
  });

  it("gives a span with one Turn a bar with a minimum width", async () => {
    serve({
      spans: [span({ start: "2026-11-14T09:08:00.000Z", end: "2026-11-14T09:08:00.000Z" })],
    });
    const { container } = openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    expect(container.querySelector<HTMLElement>(".span-bar")?.style.width).toBe("0%");
  });
});

describe("the work item of a span", () => {
  it("shows the reference, the title and the link of a cached issue", async () => {
    serve({
      spans: [
        span({
          workItem: {
            kind: "one",
            repoId: PROJECT.id,
            fullName: "acme/app",
            number: 212,
            title: "Add refunds",
            link: "https://github.com/acme/app/issues/212",
          },
        }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const row = at(await spanRows(), 0);
    const link = within(row).getByRole("link", { name: "acme/app #212" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/issues/212");
    expect(row).toHaveTextContent("Add refunds");
  });

  it("shows the number only for an issue that is not in the Work cache", async () => {
    serve({
      spans: [
        span({
          key: "a:1",
          workItem: {
            kind: "one",
            repoId: null,
            fullName: null,
            number: 7,
            title: null,
            link: null,
          },
        }),
        span({ key: "a:2", workItem: { kind: "several", count: 2 } }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const rows = within(
      await screen.findByRole("list", { name: "Spans of the session" }),
    ).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("#7");
    expect(within(at(rows, 0)).queryByRole("link")).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("2 work items");
    expect(within(at(rows, 1)).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a title as plain text, with no image, no bold and no link", async () => {
    const title = '<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)';
    serve({
      spans: [
        span({
          workItem: {
            kind: "one",
            repoId: null,
            fullName: "acme/app",
            number: 5,
            title,
            link: null,
          },
        }),
      ],
    });
    const { container } = openPage("/sessions?day=2026-11-14");
    const list = await screen.findByRole("list", { name: "Spans of the session" });
    expect(within(list).getByText(title)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).not.toBe("Fix");
  });

  it("does not make a link of an address that is not a web address", async () => {
    serve({
      spans: [
        span({
          workItem: {
            kind: "one",
            repoId: null,
            fullName: "acme/app",
            number: 5,
            title: "x",
            link: "javascript:alert(1)",
          },
        }),
      ],
    });
    openPage("/sessions?day=2026-11-14");
    const list = await screen.findByRole("list", { name: "Spans of the session" });
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("data as of and refresh state", () => {
  it("shows the time of the data and the progress of a refresh", async () => {
    serve({
      usageStatus: { ...idleStatus, state: "running", filesRead: 1240, filesTotal: 3100 },
    });
    openPage("/sessions?day=2026-11-14");
    expect(await screen.findByText("Reading the history: 1,240 of 3,100 files")).toBeVisible();
    expect(screen.getByText(/Usage data as of/)).toHaveTextContent(
      "Usage data as of 15 Nov 2026, 06:00",
    );
  });

  it("shows a failed refresh with the reason and the age of the data", async () => {
    serve({
      usageStatus: { ...idleStatus, state: "failed", reason: "The database is not available." },
    });
    openPage("/sessions?day=2026-11-14");
    expect(
      await screen.findByText(
        "The last usage refresh failed. The database is not available. The page shows the data as of 15 Nov 2026, 06:00.",
      ),
    ).toBeVisible();
  });
});

describe("the state of the Work cache", () => {
  it("names the repos that are not connected and links to Repos", async () => {
    serve({ complete: { incompleteRepos: 1, notConnected: false } });
    openPage("/sessions?day=2026-11-14&client=acme");
    const note = await screen.findByText(/Data is not complete/);
    expect(note).toHaveTextContent("Data is not complete: 1 repo not connected. See Repos.");
    expect(within(note).getByRole("link", { name: "Repos" })).toHaveAttribute(
      "href",
      "/?client=acme#dash-repos",
    );
  });

  it("says the plural for more than one repo", async () => {
    serve({ complete: { incompleteRepos: 2, notConnected: false } });
    openPage("/sessions?day=2026-11-14");
    expect(await screen.findByText(/2 repos not connected/)).toBeVisible();
  });

  it("shows the not connected text and still shows the spans", async () => {
    serve({ complete: { incompleteRepos: 2, notConnected: true } });
    openPage("/sessions?day=2026-11-14");
    expect(
      await screen.findByText(/Not connected\. Add the Foreman token to the Keychain, then run/),
    ).toHaveTextContent(
      "Not connected. Add the Foreman token to the Keychain, then run pnpm local:up.",
    );
    expect(screen.queryByText(/Data is not complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Spans of the session" })).toBeVisible();
  });
});

describe("live update", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    setVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
  });

  const sessionRequests = () => requests.filter((request) => request.startsWith("/api/sessions"));

  it("asks again for the list and the session after 60 seconds on today", async () => {
    serve({
      sessions: [summary({ start: "2026-11-15T09:00:00.000Z", end: "2026-11-15T09:50:00.000Z" })],
    });
    openPage("/sessions");
    await screen.findByRole("list", { name: "Spans of the session" });
    expect(sessionRequests()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(sessionRequests()).toHaveLength(4);
    });
  });

  it("does not ask while the tab is hidden", async () => {
    serve();
    openPage("/sessions");
    await screen.findByRole("list", { name: "Spans of the session" });
    setVisibility("hidden");
    const before = sessionRequests().length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sessionRequests()).toHaveLength(before);
  });

  it("does not ask when the page shows an earlier day", async () => {
    serve();
    openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    const before = sessionRequests().length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sessionRequests()).toHaveLength(before);
  });

  it("asks again after a Refresh in the header", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve();
    openPage("/sessions?day=2026-11-14");
    await screen.findByRole("list", { name: "Spans of the session" });
    const before = sessionRequests().length;
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(sessionRequests().length).toBeGreaterThan(before);
    });
  });
});

describe("the client scope", () => {
  it("sends the client with the list and the session", async () => {
    serve();
    openPage("/sessions?day=2026-11-14&client=acme");
    await screen.findByRole("list", { name: "Spans of the session" });
    expect(requests).toContain("/api/sessions?day=2026-11-14&tz=Europe%2FLondon&client=acme");
    expect(
      requests.some(
        (request) =>
          request.startsWith("/api/sessions/s1abcdef12345?") && request.includes("client=acme"),
      ),
    ).toBe(true);
  });
});
