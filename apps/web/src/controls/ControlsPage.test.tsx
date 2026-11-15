import type {
  ControlsRegisterRow,
  ControlsReleaseRow,
  ControlsResponse,
  ControlsWaiverRow,
} from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const PAY = "0123456789ab";
const WEB = "ba9876543210";

const file = {
  state: "ok" as const,
  ref: "main",
  sha7: "abcdef0",
  fetchedAt: "2026-11-14T10:00:00.000Z",
  skipped: [],
};
const off = { ...file, state: "module_off" as const, sha7: null, fetchedAt: null, ref: null };

function document_(over: Partial<ControlsResponse> = {}): ControlsResponse {
  return {
    state: "ok",
    modules: [
      {
        repoId: PAY,
        repo: "acme/pay",
        defaultBranch: "main",
        fileBranch: "main",
        repoState: "ok",
        configState: "ok",
        controlsKey: "ok",
        profile: "regulated",
        modules: ["control_events", "risk_tiers", "waivers"],
        controlEvents: true,
        mainBranch: null,
        productionBranch: "production",
        switchedOver: "2026-10-01",
      },
      {
        repoId: WEB,
        repo: "acme/web",
        defaultBranch: "main",
        fileBranch: "main",
        repoState: "ok",
        configState: "ok",
        controlsKey: "none",
        profile: "none",
        modules: [],
        controlEvents: false,
        mainBranch: null,
        productionBranch: null,
        switchedOver: null,
      },
    ],
    escalations: {
      rows: [
        {
          repoId: PAY,
          repo: "acme/pay",
          path: "src/ledger/transfer.ts",
          count: 2,
          pathTier: "general",
          tier: "authority",
          latestAt: "2026-11-10T10:00:00.000Z",
          latestPull: { number: 318, link: "https://github.com/acme/pay/pull/318" },
          evidence: "src/ledger/transfer.ts:42",
        },
        {
          repoId: PAY,
          repo: "acme/pay",
          path: "src/payee/match.ts",
          count: 1,
          pathTier: null,
          tier: null,
          latestAt: "2026-11-10T11:00:00.000Z",
          latestPull: null,
          evidence: null,
        },
      ],
      total: 3,
      repeatedPaths: 1,
    },
    artefacts: [
      {
        repoId: PAY,
        repo: "acme/pay",
        riskMap: {
          ...file,
          summary: { authority: 5, sensitive: 3, general: 0, inert: 1, boundaries: 2 },
        },
        controlRegister: { ...file, summary: { controls: 4 } },
        threatModel: {
          ...file,
          state: "missing_file",
          sha7: null,
          fetchedAt: null,
          summary: null,
        },
        waiverRegister: { ...file, summary: { waivers: 3 } },
      },
      {
        repoId: WEB,
        repo: "acme/web",
        riskMap: { ...off, summary: null },
        controlRegister: { ...off, summary: null },
        threatModel: {
          ...file,
          summary: {
            boundaries: 2,
            threats: 5,
            withoutControl: ["TM-4"],
            citedNotInRegister: ["CTRL-OPS-09"],
          },
        },
        waiverRegister: { ...off, summary: null },
      },
    ],
    skipped: { controlEvents: 0, files: 0, entries: 0 },
    complete: { incompleteRepos: 0 },
    ...over,
  };
}

const waiver = (id: string, over: Partial<ControlsWaiverRow> = {}): ControlsWaiverRow => ({
  repoId: PAY,
  repo: "acme/pay",
  id,
  owner: "owner-login",
  approvedBy: "op-login",
  created: "2026-01-01",
  expires: "2026-11-28",
  expiry: "expiring",
  days: 14,
  registerBranch: null,
  covers: { kind: "check", name: "trivy" },
  uses: 3,
  newestPull: { number: 318, link: "https://github.com/acme/pay/pull/318" },
  ...over,
});

const release = (name: string, over: Partial<ControlsReleaseRow> = {}): ControlsReleaseRow => ({
  repoId: PAY,
  repo: "acme/pay",
  name,
  state: "released",
  issueCount: 6,
  link: "https://github.com/acme/pay/milestone/1",
  forgeReleaseLink: `https://github.com/acme/pay/releases/tag/${name}`,
  releasePull: null,
  record: {
    kind: "ok",
    tier: "sensitive",
    approval: { kind: "approved", by: "op-login", time: "2026-02-01T10:00:00Z" },
    gaps: {
      total: 0,
      controlsNotProven: [],
      directCommits: 0,
      approvalMissing: false,
      pullRequestsWithoutReview: 0,
      other: 0,
    },
    fetchedAt: "2026-11-14T10:00:00.000Z",
  },
  ...over,
});

const control = (id: string, over: Partial<ControlsRegisterRow> = {}): ControlsRegisterRow => ({
  repoId: PAY,
  repo: "acme/pay",
  id,
  title: "Check the payee",
  owner: "owner-login",
  sources: 2,
  modules: 1,
  manualChecks: 0,
  status: { tag: "v2.2.1", status: "passing" },
  ...over,
});

interface Served {
  document?: ControlsResponse;
  waivers?: ControlsWaiverRow[][];
  releases?: ControlsReleaseRow[][];
  register?: ControlsRegisterRow[][];
}

const requests: string[] = [];

function pageRoute(pattern: string, pages: unknown[][]) {
  return http.get(pattern, ({ request }) => {
    const url = new URL(request.url);
    requests.push(`${url.pathname}${url.search}`);
    const cursor = url.searchParams.get("cursor");
    const index = cursor === null ? 0 : Number(cursor);
    return HttpResponse.json({
      items: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    });
  });
}

function serve({
  document = document_(),
  waivers = [[waiver("WAIVER-7")]],
  releases = [[release("v2.2.1")]],
  register = [[control("CTRL-PAY-03")]],
}: Served = {}) {
  requests.length = 0;
  fakeApi();
  server.use(
    http.get("*/api/controls", ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return HttpResponse.json(document);
    }),
    pageRoute("*/api/controls/waivers", waivers),
    pageRoute("*/api/controls/releases", releases),
    pageRoute("*/api/controls/register", register),
  );
}

function open(path = "/controls") {
  window.history.replaceState(null, "", path);
}

describe("the Controls page", () => {
  it("shows the sections in order and marks Controls in the nav", async () => {
    open();
    serve();
    renderApp();
    await screen.findByRole("region", { name: "Control modules table" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Control modules by repo",
      "Escalations",
      "Waivers",
      "Releases",
      "Security artefacts",
    ]);
    expect(screen.getByRole("link", { name: "Controls" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the Control modules of each repo with the Control events note", async () => {
    open();
    serve();
    renderApp();
    const table = await screen.findByRole("table", { name: "Control modules by repo" });
    const pay = within(table).getByRole("row", { name: /acme\/pay/ });
    expect(pay).toHaveTextContent("regulated");
    expect(pay).toHaveTextContent("3 modules");
    expect(pay).toHaveTextContent("control_events, risk_tiers, waivers");
    expect(pay).toHaveTextContent("Control events on");
    expect(pay).toHaveTextContent("Full review data from Control events");
    const web = within(table).getByRole("row", { name: /acme\/web/ });
    expect(web).toHaveTextContent("none");
    expect(web).toHaveTextContent("Control events off");
    expect(web).toHaveTextContent(
      "Forge data only: the Machine gate status, Factory identity reviews and merges",
    );
  });

  it("shows the state of a repo with no valid repo config", async () => {
    open();
    const base = document_();
    const [pay, web] = base.modules;
    if (pay === undefined || web === undefined) throw new Error("fixture");
    serve({
      document: document_({
        modules: [
          { ...pay, controlsKey: "not_valid" },
          { ...web, configState: "missing_file", controlsKey: null },
          { ...web, repoId: "111111111111", repo: "acme/gone", configState: "missing_ref" },
        ],
      }),
    });
    renderApp();
    const table = await screen.findByRole("table", { name: "Control modules by repo" });
    expect(table).toHaveTextContent("controls key not valid: the factory stops the control steps");
    expect(table).toHaveTextContent("no .claude/factory.json at main");
    expect(table).toHaveTextContent("no branch main");
  });

  it("shows the Escalations with the repeated paths note and the rows that it leaves out", async () => {
    open();
    serve();
    renderApp();
    const table = await screen.findByRole("table", { name: "Escalations by repo and path" });
    const first = within(table).getAllByRole("row")[1];
    expect(first).toHaveTextContent("src/ledger/transfer.ts");
    expect(first).toHaveTextContent("general");
    expect(first).toHaveTextContent("authority");
    expect(first).toHaveTextContent("2");
    expect(first).toHaveTextContent("#318");
    expect(first).toHaveTextContent("src/ledger/transfer.ts:42");
    expect(
      screen.getByText("1 path escalated 2 or more times. Change the Risk map in a pull request."),
    ).toBeInTheDocument();
    expect(screen.getByText("and 1 more")).toBeInTheDocument();
  });

  it("shows each Waiver with its expiry state as text, its covers and its uses", async () => {
    open();
    serve({
      waivers: [
        [
          waiver("WAIVER-2", { expiry: "expired", days: -1, expires: "2026-11-13", uses: 0 }),
          waiver("WAIVER-7"),
          waiver("WAIVER-4", {
            expiry: "current",
            days: 57,
            uses: 1,
            covers: {
              kind: "finding",
              file: "packages/payments/webhook.ts",
              category: "Security",
              ref: "CWE-770",
            },
          }),
          waiver("WAIVER-9", {
            expiry: "not_in_register",
            registerBranch: "main",
            expires: null,
            days: null,
            covers: null,
            owner: null,
            approvedBy: null,
            uses: 2,
            newestPull: null,
          }),
          waiver("WAIVER-8", {
            expiry: "register_not_read",
            covers: { kind: "control", id: "CTRL-PAY-03" },
          }),
        ],
      ],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Waivers" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("WAIVER-2");
    expect(items[0]).toHaveTextContent("expired");
    expect(items[0]).toHaveTextContent("used 0 times");
    expect(items[1]).toHaveTextContent("expires in 14 days");
    expect(items[1]).toHaveTextContent("check: trivy");
    expect(items[1]).toHaveTextContent("used 3 times");
    expect(items[2]).toHaveTextContent("current, 57 days");
    expect(items[2]).toHaveTextContent(
      "finding: packages/payments/webhook.ts · Security · CWE-770",
    );
    expect(items[3]).toHaveTextContent("not in the register at main");
    expect(items[3]).toHaveTextContent("used 2 times");
    expect(items[4]).toHaveTextContent("register not read");
    expect(items[4]).toHaveTextContent("control: CTRL-PAY-03");
  });

  it("shows a Waiver register that is not readable and the entries that it skips", async () => {
    open();
    const base = document_();
    const [pay, web] = base.artefacts;
    if (pay === undefined || web === undefined) throw new Error("fixture");
    serve({
      document: document_({
        artefacts: [
          { ...pay, waiverRegister: { ...pay.waiverRegister, state: "not_readable" } },
          {
            ...web,
            waiverRegister: {
              ...web.waiverRegister,
              skipped: [{ position: 2, field: "expires" }],
            },
          },
        ],
      }),
    });
    renderApp();
    const notes = await screen.findByRole("list", { name: "Waiver registers with a problem" });
    expect(notes).toHaveTextContent("acme/pay: Waiver register not readable");
    expect(notes).toHaveTextContent("acme/web: 1 Waiver not readable: position 2, field expires");
  });

  it("shows a released Release with its record, and an open Release with its pull request", async () => {
    open();
    serve({
      releases: [
        [
          release("v2.3.0", {
            state: "open",
            issueCount: 2,
            forgeReleaseLink: null,
            releasePull: {
              number: 330,
              link: "https://github.com/acme/pay/pull/330",
              checks: "success",
              review: "fail",
            },
            record: { kind: "none", reason: "before_release" },
          }),
          release("v2.2.1"),
          release("v2.2.0", {
            record: {
              kind: "ok",
              tier: null,
              approval: { kind: "missing" },
              gaps: {
                total: 3,
                controlsNotProven: ["CTRL-PAY-07"],
                directCommits: 1,
                approvalMissing: true,
                pullRequestsWithoutReview: 0,
                other: 0,
              },
              fetchedAt: "2026-11-14T10:00:00.000Z",
            },
          }),
        ],
      ],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Releases" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("v2.3.0");
    expect(items[0]).toHaveTextContent("open");
    expect(items[0]).toHaveTextContent("release pull request #330");
    expect(items[0]).toHaveTextContent("release review fail");
    expect(items[0]).toHaveTextContent("no Release record before the release");
    expect(items[1]).toHaveTextContent("released");
    expect(items[1]).toHaveTextContent("6 issues");
    expect(items[1]).toHaveTextContent("sensitive");
    expect(items[1]).toHaveTextContent("approved by op-login");
    expect(items[1]).toHaveTextContent("no gaps");
    expect(within(items[1] ?? list).getByRole("link", { name: /in the forge/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/pay/releases/tag/v2.2.1",
    );
    expect(items[2]).toHaveTextContent(
      "3 gaps: 1 Control not proven (CTRL-PAY-07), 1 commit with no pull request, Release approval missing",
    );
  });

  it("shows why a Release has no record", async () => {
    open();
    serve({
      releases: [
        [
          release("v1", { record: { kind: "none", reason: "no_record" } }),
          release("v2", { record: { kind: "none", reason: "more_than_one_record" } }),
          release("v3", { record: { kind: "none", reason: "no_forge_release" } }),
          release("v4", { record: { kind: "none", reason: "not_readable" } }),
          release("v5", { record: { kind: "none", reason: "module_off" } }),
        ],
      ],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Releases" });
    const text = within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(text[0]).toContain("no Release record");
    expect(text[1]).toContain("more than one Release record");
    expect(text[2]).toContain("no forge release");
    expect(text[3]).toContain("Release record not readable");
    expect(text[4]).toContain("Release record module off");
  });

  it("shows the Security artefacts of each repo, and the file that a module needs and misses", async () => {
    open();
    serve();
    renderApp();
    const list = await screen.findByRole("list", { name: "Security artefacts by repo" });
    const [pay, web] = within(list).getAllByRole("heading", { level: 3 });
    const payItem = pay?.closest("li");
    const webItem = web?.closest("li");
    expect(payItem).toHaveTextContent(
      "Risk map: authority 5, sensitive 3, general 0, inert 1 globs; 2 boundaries",
    );
    expect(payItem).toHaveTextContent("Control register: 4 Controls");
    expect(payItem).toHaveTextContent("abcdef0");
    expect(payItem).toHaveTextContent("data as of");
    expect(payItem).toHaveTextContent(
      "threat_model is on, but the Threat model is missing at main",
    );
    expect(webItem).toHaveTextContent("Risk map: module off");
    expect(webItem).toHaveTextContent(
      "Threat model: 2 boundaries, 5 threats, 1 with no Control (TM-4), 1 cited Control not in the register (CTRL-OPS-09)",
    );
  });

  it("shows the Control register list with the status in the newest Release record", async () => {
    open();
    serve({
      register: [[control("CTRL-PAY-03"), control("CTRL-PAY-07", { status: null })]],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Control register" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("CTRL-PAY-03");
    expect(items[0]).toHaveTextContent("Check the payee");
    expect(items[0]).toHaveTextContent("passing in v2.2.1");
    expect(items[0]).toHaveTextContent("2 sources · 1 module · 0 manual checks");
    expect(items[1]).toHaveTextContent("not in a Release record");
  });

  it("loads the next page of a list with Show more", async () => {
    open();
    serve({ waivers: [[waiver("WAIVER-1")], [waiver("WAIVER-2")]] });
    renderApp();
    const list = await screen.findByRole("list", { name: "Waivers" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    });
    expect(requests.some((request) => request.includes("/waivers?cursor=1"))).toBe(true);
  });

  it("shows Data is not complete in the four sections that use the Work cache", async () => {
    open();
    serve({ document: document_({ complete: { incompleteRepos: 1 } }) });
    renderApp();
    await screen.findByRole("table", { name: "Control modules by repo" });
    expect(screen.getAllByText(/Data is not complete: 1 repo not connected\./)).toHaveLength(4);
    expect(screen.getAllByRole("link", { name: "Repos" })[0]).toHaveAttribute(
      "href",
      "/#dash-repos",
    );
  });

  it("shows Not connected, the Escalations and the Waiver uses when no repo has a cache", async () => {
    open();
    serve({
      document: document_({ state: "not_connected", modules: [], artefacts: [] }),
      waivers: [[waiver("WAIVER-9", { expiry: "register_not_read", covers: null, uses: 2 })]],
      releases: [[]],
      register: [[]],
    });
    renderApp();
    await screen.findByRole("table", { name: "Escalations by repo and path" });
    expect(screen.getAllByText(/Not connected\. Add the Foreman token/)).toHaveLength(4);
    expect(screen.queryByRole("table", { name: "Control modules by repo" })).toBeNull();
    const waivers = await screen.findByRole("list", { name: "Waivers" });
    expect(waivers).toHaveTextContent("WAIVER-9");
    expect(waivers).toHaveTextContent("register not read");
    expect(waivers).toHaveTextContent("used 2 times");
  });

  it("shows markup in a title, an owner and a path as plain text, with no extra link or image", async () => {
    open();
    const html = '<img src="https://evil.example/t.png"> **bold** [a](https://evil.example)';
    serve({
      waivers: [[waiver("WAIVER-1", { owner: html })]],
      register: [[control("CTRL-PAY-03", { title: html })]],
    });
    const { container } = renderApp();
    await screen.findByRole("list", { name: "Control register" });
    expect(screen.getAllByText(new RegExp("evil\\.example", "u")).length).toBeGreaterThan(1);
    expect(container.querySelector("img")).toBeNull();
    expect(
      [...container.querySelectorAll("a")].every((a) => !a.href.includes("evil.example")),
    ).toBe(true);
  });

  it("shows a link only when the cache gives a web address", async () => {
    open();
    serve({
      releases: [[release("v1", { link: "javascript:alert(1)", forgeReleaseLink: null })]],
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Releases" });
    expect(within(list).queryByRole("link")).toBeNull();
  });

  it("asks for the data of the Client scope", async () => {
    open("/controls?client=acme");
    serve();
    renderApp();
    await screen.findByRole("list", { name: "Waivers" });
    expect(requests).toContain("/api/controls?client=acme");
    expect(requests).toContain("/api/controls/waivers?client=acme");
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

  it("asks again for the data and each list each 60 seconds, and not in a hidden tab", async () => {
    open();
    serve();
    renderApp();
    await screen.findByRole("list", { name: "Control register" });
    const before = requests.length;
    expect(before).toBe(4);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(before + 4);
    });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(before + 4);
  });
});
