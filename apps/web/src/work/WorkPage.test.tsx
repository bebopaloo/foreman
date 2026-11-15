import type { WorkItem, WorkItemsResponse } from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp, type FakeRepo } from "../test-render.tsx";
import { server } from "../test-server.ts";

const APP = "0123456789ab";
const WEB = "ba9876543210";

const REPOS: FakeRepo[] = [
  { id: APP, fullName: "acme/app", client: "acme", dataAsOf: null },
  { id: WEB, fullName: "acme/web", client: "acme", dataAsOf: null },
  { id: "aaaaaaaaaaaa", fullName: "globex/api", client: "globex", dataAsOf: null },
];

type Issue = NonNullable<WorkItem["issue"]>;
type Pull = NonNullable<WorkItem["pullRequest"]>;

interface ItemOptions extends Partial<Omit<WorkItem, "issue" | "pullRequest">> {
  n?: number;
  /** Changes to the issue, or null for a row with no issue. */
  issue?: Partial<Issue> | null;
  /** Changes to the pull request, or null for a row with no pull request. */
  pr?: Partial<Pull> | null;
}

function item(over: ItemOptions = {}): WorkItem {
  const { n = 12, issue, pr, ...rest } = over;
  return {
    repoId: APP,
    fullName: "acme/app",
    client: "acme",
    issue:
      issue === null
        ? null
        : {
            number: n,
            title: "Add the export",
            state: "open",
            issueState: "IN REVIEW",
            type: "feature",
            priority: "high",
            link: `https://github.com/acme/app/issues/${n.toString()}`,
            stale: false,
            ...issue,
          },
    pullRequest:
      pr === null
        ? null
        : {
            number: 40,
            title: "Add the export",
            state: "open",
            draft: false,
            checks: "success",
            link: "https://github.com/acme/app/pull/40",
            stale: false,
            otherCount: 0,
            ...pr,
          },
    machineGate: { source: "forge", value: "pass" },
    round: 2,
    riskTier: "sensitive",
    ...rest,
  };
}

const counts = {
  all: 1,
  TODO: 0,
  READY: 0,
  "IN PROGRESS": 0,
  "IN REVIEW": 1,
  BLOCKED: 0,
  DONE: 0,
  CANCELLED: 0,
  none: 0,
};

function response(over: Partial<WorkItemsResponse> = {}): WorkItemsResponse {
  return {
    state: "ok",
    items: [item()],
    nextCursor: null,
    counts,
    complete: 0,
    noControlEvents: [],
    skipped: { controlEvents: 0, files: 0 },
    ...over,
  };
}

/** Each request for the items as path and query. */
function fakeItems(answer: (url: URL) => WorkItemsResponse = () => response()): string[] {
  const requests: string[] = [];
  server.use(
    http.get("*/api/work/items", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return HttpResponse.json(answer(url));
    }),
  );
  return requests;
}

function open(path = "/work") {
  window.history.replaceState(null, "", path);
  fakeApi({ repos: REPOS });
}

describe("the Work page rows", () => {
  it("shows the fields of an issue with its pull request and both links", async () => {
    open();
    fakeItems();
    renderApp();
    const table = await screen.findByRole("table", { name: "Issues and pull requests" });
    const cells = within(table).getAllByRole("row")[1]?.querySelectorAll("td");
    const texts = Array.from(cells ?? []).map((cell) => cell.textContent);
    expect(texts.slice(0, 11)).toEqual([
      "acme/app",
      "#12",
      "Add the export",
      "IN REVIEW",
      "feature",
      "high",
      "#40",
      "success",
      "pass",
      "2",
      "sensitive",
    ]);
    expect(
      screen.getByRole("link", { name: "Issue 12 of acme/app in the tracker" }),
    ).toHaveAttribute("href", "https://github.com/acme/app/issues/12");
    const pr = screen.getByRole("link", { name: "Pull request 40 of acme/app in the forge" });
    expect(pr).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a dash for an issue with no pull request, and only the Issue link", async () => {
    open();
    fakeItems(() =>
      response({
        items: [item({ pr: null, machineGate: null, round: null, riskTier: null })],
      }),
    );
    renderApp();
    const row = (await screen.findAllByRole("row"))[1];
    const cells = Array.from(row?.querySelectorAll("td") ?? []).map((cell) => cell.textContent);
    expect(cells.slice(6, 11)).toEqual(["—", "—", "—", "—", "—"]);
    expect(screen.getAllByRole("link", { name: /in the tracker/ })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /in the forge/ })).not.toBeInTheDocument();
  });

  it("shows a pull request with no issue as its own row", async () => {
    open();
    fakeItems(() => response({ items: [item({ issue: null, riskTier: null })] }));
    renderApp();
    const row = (await screen.findAllByRole("row"))[1];
    const cells = Array.from(row?.querySelectorAll("td") ?? []).map((cell) => cell.textContent);
    expect(cells.slice(0, 6)).toEqual(["acme/app", "—", "Add the export", "no issue", "—", "—"]);
    expect(screen.queryByRole("link", { name: /in the tracker/ })).not.toBeInTheDocument();
  });

  it("shows TODO · closed for a closed issue with no end state", async () => {
    open();
    fakeItems(() =>
      response({
        items: [
          item({
            issue: { state: "closed", issueState: "TODO" },
          }),
        ],
      }),
    );
    renderApp();
    expect(await screen.findByText("TODO · closed")).toBeInTheDocument();
  });

  it("marks the Machine gate from an event, a draft, more pull requests and a stale item", async () => {
    open();
    fakeItems(() =>
      response({
        items: [
          item({
            machineGate: { source: "events", value: "wait" },
            pr: { draft: true, otherCount: 1, stale: true },
          }),
        ],
      }),
    );
    renderApp();
    expect(await screen.findByText("wait (event)")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("1 more")).toBeInTheDocument();
    expect(screen.getByText("not in the last fetch")).toBeInTheDocument();
  });

  it("describes the Machine gate column", async () => {
    open();
    fakeItems();
    renderApp();
    const header = await screen.findByRole("columnheader", { name: /Machine gate/ });
    expect(header).toHaveAccessibleDescription(/\(event\): the newest gate Control event/);
  });

  it("shows a title as plain text, with no image and no link", async () => {
    open();
    const title = '<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)';
    fakeItems(() =>
      response({
        items: [item({ issue: { title } })],
      }),
    );
    const { container } = renderApp();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[href*='evil.example']")).toBeNull();
    expect(container.querySelector("table strong")).toBeNull();
  });

  it("shows no Issue link when the cached link is null", async () => {
    open();
    fakeItems(() =>
      response({
        items: [item({ issue: { link: null } })],
      }),
    );
    renderApp();
    await screen.findByRole("table", { name: "Issues and pull requests" });
    expect(screen.queryByRole("link", { name: /in the tracker/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /in the forge/ })).toBeInTheDocument();
  });

  it("does not link an address that is not a web address", async () => {
    open();
    fakeItems(() =>
      response({
        items: [
          item({
            issue: { link: "javascript:alert(1)" },
          }),
        ],
      }),
    );
    renderApp();
    await screen.findByRole("table", { name: "Issues and pull requests" });
    expect(screen.queryByRole("link", { name: /in the tracker/ })).not.toBeInTheDocument();
  });
});

describe("the filters", () => {
  it("shows the counts, filters by a state and keeps the value in the URL", async () => {
    open("/work?client=acme");
    const requests = fakeItems((url) =>
      response({
        counts: { ...counts, all: 7, READY: 3, BLOCKED: 2, DONE: 1, none: 1 },
        items: url.searchParams.get("issue_state") === "BLOCKED" ? [item(), item({ n: 13 })] : [],
      }),
    );
    const user = userEvent.setup();
    renderApp();
    const group = await screen.findByRole("group", { name: "Filter by Issue state" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "All 7",
      "TODO 0",
      "READY 3",
      "IN PROGRESS 0",
      "IN REVIEW 1",
      "BLOCKED 2",
      "DONE 1",
      "CANCELLED 0",
      "No issue 1",
    ]);
    expect(screen.getByRole("button", { name: "All 7" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "BLOCKED 2" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "BLOCKED 2" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(window.location.search).toContain("issue_state=BLOCKED");
    expect(window.location.search).toContain("client=acme");
    await waitFor(() => {
      expect(requests.at(-1)).toContain("issue_state=BLOCKED");
    });
    expect(requests.at(-1)).toContain("client=acme");
    expect(await screen.findAllByRole("row")).toHaveLength(3);
  });

  it("sends the type, the priority, the repo and the sort", async () => {
    open("/work");
    const requests = fakeItems();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Issues and pull requests" });
    await user.selectOptions(screen.getByLabelText("Type"), "feature");
    await user.selectOptions(screen.getByLabelText("Priority"), "high");
    await user.selectOptions(screen.getByLabelText("Repo"), "acme/app");
    await user.selectOptions(screen.getByLabelText("Sort"), "priority");
    await waitFor(() => {
      const last = new URL(requests.at(-1) ?? "", "http://x").searchParams;
      expect(Object.fromEntries(last)).toEqual({
        type: "feature",
        priority: "high",
        repo: APP,
        sort: "priority",
      });
    });
  });

  it("lists only the repos of the client in the repo filter", async () => {
    open("/work?client=acme");
    fakeItems();
    renderApp();
    const select = await screen.findByLabelText("Repo");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All repos", "acme/app", "acme/web"]);
  });

  it("shows a message and no rows for a value that is not valid", async () => {
    open("/work?client=acme&issue_state=DOING");
    const requests = fakeItems();
    renderApp();
    expect(
      await screen.findByText(/This link has a filter value that is not valid\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all work" })).toHaveAttribute(
      "href",
      "/work?client=acme",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });
});

describe("notes and states", () => {
  it("says that data is not complete and links Repos in the same scope", async () => {
    open("/work?client=acme");
    fakeItems(() => response({ complete: 1 }));
    renderApp();
    expect(await screen.findByText(/Data is not complete: 1 repo not connected\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Repos" })).toHaveAttribute(
      "href",
      "/?client=acme#dash-repos",
    );
  });

  it("names a repo with no Control events", async () => {
    open();
    fakeItems(() => response({ noControlEvents: [WEB] }));
    renderApp();
    expect(
      await screen.findByText(
        "No Control events in 30 days for acme/web. Round and the event Machine gate show —.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the not connected text and no table", async () => {
    open();
    fakeItems(() => response({ state: "not_connected", items: [], complete: 3 }));
    renderApp();
    expect(await screen.findByText(/^Not connected\. Add the Foreman token/)).toBeInTheDocument();
    expect(screen.getByText("pnpm local:up")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("tells the Operator when the items cannot be read", async () => {
    open();
    server.use(http.get("*/api/work/items", () => new HttpResponse(null, { status: 500 })));
    renderApp();
    expect(await screen.findByText(/The work items cannot be read/)).toBeInTheDocument();
  });
});

describe("Show more", () => {
  function pagedItems(total: number, pageSize: number): string[] {
    return fakeItems((url) => {
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const end = Math.min(start + pageSize, total);
      return response({
        items: Array.from({ length: end - start }, (_, index) => item({ n: 1000 - start - index })),
        nextCursor: end < total ? end.toString() : null,
        counts: { ...counts, all: total },
      });
    });
  }

  it("adds each page, moves the focus to the first new row and then hides the button", async () => {
    open();
    pagedItems(230, 100);
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Issues and pull requests" });
    expect(screen.getAllByRole("row")).toHaveLength(101);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(201);
    });
    expect(await screen.findByText("100 more rows shown")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("row")[101]).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(231);
    });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
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

  it("asks for the first page and one more page after 60 seconds, and not in a hidden tab", async () => {
    open();
    const requests = fakeItems((url) =>
      response({ nextCursor: url.searchParams.get("cursor") === null ? "c1" : null }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await screen.findByRole("table", { name: "Issues and pull requests" });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(4);
    });
    expect(requests[2]).toBe("/api/work/items?sort=repo");
    expect(requests[3]).toBe("/api/work/items?sort=repo&cursor=c1");
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(4);
  });
});
