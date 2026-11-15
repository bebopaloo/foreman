import type {
  FactoryRunRow,
  FactoryRunsResponse,
  PluginRow,
  PluginVersionsResponse,
  RuleDriftRepo,
  RuleDriftResponse,
  RuleDriftRule,
} from "@foreman/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";

const originalZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "UTC";
});

afterAll(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

const HOSTILE = '<img src="https://evil.example/t.png"> **bold** [a](https://evil.example)';

function plugin(over: Partial<PluginRow> = {}): PluginRow {
  return {
    key: "factory-core@demo-market",
    plugin: "factory-core",
    marketplace: "demo-market",
    installedVersion: "0.30.0",
    installLastUpdated: "2026-11-01T09:00:00.000Z",
    marketplaceVersion: "0.37.5",
    state: "update_available",
    otherScopeInstalls: 0,
    ...over,
  };
}

function plugins(
  items: PluginRow[] = [
    plugin(),
    plugin({
      key: "stack-ts@demo-market",
      plugin: "stack-ts",
      installedVersion: "0.10.0",
      marketplaceVersion: "0.10.0",
      state: "current",
    }),
  ],
  over: Partial<PluginVersionsResponse> = {},
): PluginVersionsResponse {
  return {
    items,
    nextCursor: null,
    pluginData: "ok",
    marketplaces: [
      {
        name: "demo-market",
        sourceKind: "github",
        lastUpdated: "2026-11-14T08:30:00.000Z",
        state: "readable",
        localFolder: false,
      },
    ],
    skipped: { files: 0 },
    ...over,
  };
}

function rule(over: Partial<RuleDriftRule> = {}): RuleDriftRule {
  return {
    name: "coding",
    kind: "rule",
    state: "current",
    errorState: null,
    ref: "main",
    stampPlugin: "factory-core",
    stampVersion: "0.30.0",
    sourcePlugin: "factory-core",
    sourceVersion: "0.30.0",
    ...over,
  };
}

const EMPTY_SUMMARY = {
  current: 0,
  behind: 0,
  edited_by_team: 0,
  differs: 0,
  missing_file: 0,
  missing_ref: 0,
  no_template: 0,
  not_unique: 0,
  not_readable: 0,
  failed: 0,
  not_read: 0,
};

function repo(rules: RuleDriftRule[], over: Partial<RuleDriftRepo> = {}): RuleDriftRepo {
  const summary = { ...EMPTY_SUMMARY };
  for (const entry of rules) summary[entry.state] += 1;
  return {
    repoId: "0123456789ab",
    repo: "acme/app",
    connection: "connected",
    dataAsOf: "2026-11-15T09:00:00.000Z",
    defaultBranch: "main",
    fileBranch: "main",
    mainBranch: null,
    configState: "ok",
    factoryCoreVersion: "0.30.0",
    stackPack: null,
    stackPackInstalled: null,
    installedFactoryCoreVersion: "0.30.0",
    summary,
    rules,
    ...over,
  };
}

function drift(
  items: RuleDriftRepo[] = [repo([rule(), rule({ name: "typescript" }), rule({ name: "gdpr" })])],
  over: Partial<RuleDriftResponse> = {},
): RuleDriftResponse {
  return {
    items,
    nextCursor: null,
    state: "ok",
    complete: { incompleteRepos: 0 },
    skipped: { templates: 0 },
    ...over,
  };
}

const NO_RESULTS = {
  merged: 0,
  "merge-ready": 0,
  blocked: 0,
  cancelled: 0,
  "in review": 0,
  "stopped at run end": 0,
  running: 0,
};

const results = (counts: Partial<FactoryRunRow["results"]>): FactoryRunRow["results"] => ({
  ...NO_RESULTS,
  ...counts,
});

function run(over: Partial<FactoryRunRow> = {}): FactoryRunRow {
  return {
    runId: "run-a",
    start: "2026-11-13T01:00:00.000Z",
    end: "2026-11-13T05:41:00.000Z",
    running: false,
    builds: 8,
    results: results({ merged: 6, blocked: 1, "in review": 1 }),
    peak: 4,
    slotLimit: 5,
    skips: 0,
    blockedAtSelection: 0,
    stoppedItems: [],
    ...over,
  };
}

function runs(
  items: FactoryRunRow[] = [run()],
  over: Partial<FactoryRunsResponse> = {},
): FactoryRunsResponse {
  return {
    items,
    nextCursor: null,
    sources: { runs: "ok" },
    skipped: { nightLogLines: 0, files: 0 },
    ...over,
  };
}

interface Served {
  plugins?: PluginVersionsResponse;
  drift?: RuleDriftResponse;
  runs?: FactoryRunsResponse;
}

/** Each request to the Factory health routes, as path and query. */
const requests: string[] = [];

function serve(served: Served = {}) {
  requests.length = 0;
  fakeApi();
  const record = (request: Request) => {
    const url = new URL(request.url);
    requests.push(`${url.pathname}${url.search}`);
  };
  server.use(
    http.get("*/api/factory-health/plugins", ({ request }) => {
      record(request);
      return HttpResponse.json(served.plugins ?? plugins());
    }),
    http.get("*/api/factory-health/rule-drift", ({ request }) => {
      record(request);
      return HttpResponse.json(served.drift ?? drift());
    }),
    http.get("*/api/factory-health/runs", ({ request }) => {
      record(request);
      return HttpResponse.json(served.runs ?? runs());
    }),
  );
}

function open(path = "/health") {
  window.history.replaceState(null, "", path);
}

async function show(served: Served = {}, path = "/health") {
  open(path);
  serve(served);
  renderApp();
  await waitFor(() => {
    expect(screen.queryByText(/^Reading the /)).toBeNull();
  });
}

describe("the Factory health page", () => {
  it("shows the three sections in order, and the nav link marked as current", async () => {
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Factory health");
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Plugin versions",
      "Rule drift",
      "Unattended runs",
    ]);
    expect(screen.getByRole("link", { name: "Factory health" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Factory health" })).toHaveAttribute("href", "/health");
  });

  it("shows the Client scope and keeps it in the requests of the scoped sections", async () => {
    await show({}, "/health?client=acme");
    expect(screen.getByRole("link", { name: "Factory health" })).toHaveAttribute(
      "href",
      "/health?client=acme",
    );
    expect(requests).toContain("/api/factory-health/plugins");
    expect(requests).toContain("/api/factory-health/rule-drift?client=acme");
    expect(requests).toContain("/api/factory-health/runs?client=acme");
    expect(screen.getByText("The whole factory: the same in every scope")).toBeInTheDocument();
  });
});

describe("Plugin versions", () => {
  it("shows an update and a current plugin, and the Marketplace copy note", async () => {
    await show();
    const table = screen.getByRole("table", { name: "Plugin versions" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("factory-core@demo-market");
    expect(rows[1]).toHaveTextContent("0.30.0");
    expect(rows[1]).toHaveTextContent("0.37.5 available");
    expect(rows[2]).toHaveTextContent("stack-ts@demo-market");
    expect(rows[2]).toHaveTextContent("current");
    expect(screen.getByRole("list", { name: "Marketplaces" })).toHaveTextContent(
      "Marketplace copy demo-market (github) as of 14 Nov 2026 08:30",
    );
    expect(
      screen.getByText(
        "Foreman makes no network call. A version that is newer than this copy does not show.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["newer_than_marketplace", "newer than the Marketplace copy"],
    ["differs_from_marketplace", "differs from the Marketplace copy"],
    ["not_in_marketplace", "not in the Marketplace"],
    ["marketplace_not_known", "Marketplace not known"],
    ["version_not_in_marketplace_copy", "version not in the local Marketplace copy"],
    ["version_not_readable", "version not readable"],
  ] as const)("shows the state %s as text", async (state, text) => {
    await show({ plugins: plugins([plugin({ state, marketplaceVersion: "0.8.0" })]) });
    expect(
      within(screen.getByRole("table", { name: "Plugin versions" })).getAllByRole("row")[1],
    ).toHaveTextContent(text);
  });

  it("shows how to read a local folder Marketplace", async () => {
    const marketplaces = [
      {
        name: "local",
        sourceKind: "directory",
        lastUpdated: null,
        state: "not_readable" as const,
        localFolder: true,
      },
    ];
    await show({
      plugins: plugins([plugin({ marketplace: "local", state: "marketplace_not_readable" })], {
        marketplaces,
      }),
    });
    expect(screen.getByRole("table", { name: "Plugin versions" })).toHaveTextContent(
      "Marketplace not readable by Foreman: set FOREMAN_MARKETPLACE_DIR",
    );
  });

  it("shows the note of a readable local folder", async () => {
    await show({
      plugins: plugins([plugin({ state: "current" })], {
        marketplaces: [
          {
            name: "demo-market",
            sourceKind: "directory",
            lastUpdated: null,
            state: "readable",
            localFolder: true,
          },
        ],
      }),
    });
    expect(screen.getByRole("list", { name: "Marketplaces" })).toHaveTextContent(
      "a local folder: Foreman reads its files as they are now",
    );
  });

  it("shows the installs in other scopes", async () => {
    await show({ plugins: plugins([plugin({ otherScopeInstalls: 2 })]) });
    expect(screen.getByRole("table", { name: "Plugin versions" })).toHaveTextContent(
      "2 installs in other scopes, not compared",
    );
  });

  it("shows no plugin data and still shows the other sections", async () => {
    await show({ plugins: plugins([], { pluginData: "missing", marketplaces: [] }) });
    expect(screen.getByText(/No plugin data:/, { selector: "p" })).toHaveTextContent(
      "No plugin data: installed_plugins.json is missing or not readable",
    );
    expect(screen.getByText("acme/app")).toBeInTheDocument();
    expect(screen.getByText("8 builds: 6 merged, 1 blocked, 1 in review")).toBeInTheDocument();
  });

  it("shows the plugin text as plain text", async () => {
    await show({
      plugins: plugins([
        plugin({ key: HOSTILE, plugin: HOSTILE, state: "differs_from_marketplace" }),
      ]),
    });
    expect(screen.getByText(HOSTILE)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("section a[href*='evil']")).toBeNull();
  });

  it("shows more plugin rows with the cursor", async () => {
    open();
    fakeApi();
    const cursors: (string | null)[] = [];
    server.use(
      http.get("*/api/factory-health/rule-drift", () => HttpResponse.json(drift())),
      http.get("*/api/factory-health/runs", () => HttpResponse.json(runs())),
      http.get("*/api/factory-health/plugins", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? plugins([plugin()], { nextCursor: "2" })
            : plugins([plugin({ key: "stack-ts@demo-market", state: "current" })]),
        );
      }),
    );
    renderApp();
    const button = await screen.findByRole("button", { name: "Show more" });
    await userEvent.click(button);
    expect(await screen.findByText("stack-ts@demo-market")).toBeInTheDocument();
    expect(cursors).toContain("2");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows an error when the route fails, and the other sections still show", async () => {
    open();
    serve();
    server.use(
      http.get("*/api/factory-health/plugins", () => new HttpResponse(null, { status: 500 })),
    );
    renderApp();
    expect(
      await screen.findByText("The plugin versions cannot be read", { exact: false }),
    ).toBeInTheDocument();
    expect(await screen.findByText("acme/app")).toBeInTheDocument();
  });
});

describe("Rule drift", () => {
  it("shows a repo whose rules match the templates", async () => {
    await show();
    const list = screen.getByRole("list", { name: "Repo rules of acme/app" });
    expect(screen.getByText("3 Repo rules match the templates")).toBeInTheDocument();
    expect(within(list).getAllByText("current")).toHaveLength(3);
    expect(screen.getByText(/data as of 15 Nov 2026 09:00/)).toBeInTheDocument();
  });

  it("shows each rule state as text", async () => {
    const rules = [
      rule({ name: "a", stampVersion: "0.8.1" }),
      rule({ name: "b", stampVersion: null }),
      rule({ name: "c", state: "behind", stampVersion: "0.8.1" }),
      rule({ name: "d", state: "edited_by_team", stampVersion: "0.8.1" }),
      rule({ name: "e", state: "differs", stampVersion: null }),
      rule({ name: "f", state: "missing_file", ref: "main" }),
      rule({ name: "g", state: "no_template", sourcePlugin: null, sourceVersion: null }),
      rule({ name: "h", state: "not_unique" }),
      rule({ name: "i", state: "failed", errorState: "rate limit" }),
      rule({ name: "j", state: "missing_ref" }),
    ];
    await show({ drift: drift([repo(rules)]) });
    const list = screen.getByRole("list", { name: "Repo rules of acme/app" });
    const text = within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(text).toEqual([
      "acurrent, stamp 0.8.1",
      "bcurrent, no stamp",
      "cbehind: the template changed after 0.8.1",
      "dedited by the team",
      "edifferś from the templateForeman cannot tell a team edit from a template change.".replace(
        "ś",
        "s",
      ),
      "fmissing at main",
      "gno template in the installed plugins",
      "htemplate name not unique",
      "irate limit",
      "jbranch not found",
    ]);
    expect(
      screen.getByText(
        "1 Repo rule behind factory-core 0.30.0, 1 Repo rule edited by the team, 1 Repo rule differing from the template, 1 Repo rule missing, 1 Repo rule on a branch that is not found, 1 Repo rule with no template in the installed plugins, 1 Repo rule with a template name that is not unique, 1 Repo rule not read: adapter error",
      ),
    ).toBeInTheDocument();
  });

  it("shows a rule file that is too large, one with an invalid output and one with an adapter error", async () => {
    const rules = [
      rule({ name: "a", state: "failed", errorState: "file too large" }),
      rule({ name: "b", state: "failed", errorState: "invalid adapter output" }),
      rule({ name: "c", state: "failed", errorState: "adapter error" }),
    ];
    await show({ drift: drift([repo(rules)]) });
    const list = screen.getByRole("list", { name: "Repo rules of acme/app" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["afile too large", "binvalid adapter output", "cadapter error"]);
  });

  it("shows the summary of one rule behind", async () => {
    const rules = [rule(), rule({ name: "security", state: "behind", stampVersion: "0.8.1" })];
    await show({ drift: drift([repo(rules)]) });
    expect(screen.getByText("1 Repo rule behind factory-core 0.30.0")).toBeInTheDocument();
  });

  it("shows a missing Stack pack, a main branch that differs and a compliance rule", async () => {
    await show({
      drift: drift([
        repo([rule({ name: "gdpr", kind: "compliance" })], {
          defaultBranch: "trunk",
          mainBranch: "main",
          stackPack: { name: "stack-py", version: "0.1.0" },
          stackPackInstalled: false,
        }),
      ]),
    });
    expect(screen.getByText(/is not installed/)).toHaveTextContent(
      "Stack pack stack-py is not installed",
    );
    expect(screen.getByText(/the main branch in the factory config is/)).toHaveTextContent(
      "the main branch in the factory config is main, the default branch is trunk",
    );
    expect(screen.getByText("compliance")).toBeInTheDocument();
  });

  it.each([
    ["not_set_up", "not set up: no .claude/factory.json at main"],
    ["not_readable", "factory config not readable"],
    ["branch_not_found", "branch not found"],
  ] as const)("shows the config state %s and no rule list", async (configState, text) => {
    await show({ drift: drift([repo([], { configState })]) });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Repo rules of acme/app" })).toBeNull();
  });

  it("shows the repos that are not connected, with the incomplete note", async () => {
    await show({
      drift: drift(
        [
          repo([rule()]),
          repo([], {
            repoId: "ba9876543210",
            repo: "acme/site",
            connection: "not connected: no token",
            configState: "not_read",
            dataAsOf: null,
          }),
        ],
        { complete: { incompleteRepos: 1 } },
      ),
    });
    expect(screen.getByText(/Data is not complete:/)).toHaveTextContent(
      "Data is not complete: 1 repo not connected. See Repos.",
    );
    expect(screen.getByRole("link", { name: "Repos" })).toHaveAttribute("href", "/#dash-repos");
    expect(screen.getByText("not connected: no token")).toBeInTheDocument();
  });

  it("shows Not connected, and the other sections still show", async () => {
    await show({ drift: drift([], { state: "not_connected" }) });
    expect(screen.getByText(/Not connected\./)).toHaveTextContent(
      "Not connected. Add the Foreman token to the Keychain, then run pnpm local:up.",
    );
    expect(screen.getByRole("table", { name: "Plugin versions" })).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Unattended runs, newest first" }),
    ).toBeInTheDocument();
  });

  it("shows the cached data of a failed fetch with its time and its reason", async () => {
    await show({ drift: drift([repo([rule()], { connection: "rate limit" })]) });
    expect(screen.getByText("rate limit")).toBeInTheDocument();
    expect(screen.getByText(/data as of 15 Nov 2026 09:00/)).toBeInTheDocument();
  });

  it("shows no repo in a scope that has none", async () => {
    await show({ drift: drift([]) });
    expect(screen.getByText("No repo in this scope.")).toBeInTheDocument();
  });
});

describe("Unattended runs", () => {
  const nightA = run();
  const nightC = run({
    runId: "run-c",
    start: "2026-11-14T01:00:00.000Z",
    end: "2026-11-14T06:58:00.000Z",
    builds: 10,
    results: results({ merged: 10 }),
    peak: 5,
  });

  it("shows the runs newest first with the night, the window, the builds and the peak", async () => {
    await show({ runs: runs([nightC, nightA]) });
    const table = screen.getByRole("table", { name: "Unattended runs, newest first" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("2026-11-14");
    expect(rows[1]).toHaveTextContent("01:00–06:58");
    expect(rows[2]).toHaveTextContent("2026-11-13");
    expect(rows[2]).toHaveTextContent("01:00–05:41");
    expect(rows[2]).toHaveTextContent("8 builds: 6 merged, 1 blocked, 1 in review");
    expect(rows[2]).toHaveTextContent("peak 4 of 5");
  });

  it("shows the peak with no slot count in a client scope", async () => {
    await show({
      runs: runs([run({ slotLimit: null, peak: 3, builds: 3, results: results({ merged: 3 }) })]),
    });
    const table = screen.getByRole("table", { name: "Unattended runs, newest first" });
    expect(table).toHaveTextContent("peak 3 at one time");
    expect(table).not.toHaveTextContent("of 5");
  });

  it("shows the skips and the issues blocked at selection", async () => {
    await show({ runs: runs([run({ skips: 9, blockedAtSelection: 1 })]) });
    const table = screen.getByRole("table", { name: "Unattended runs, newest first" });
    expect(table).toHaveTextContent("9 skips");
    expect(table).toHaveTextContent("1 blocked at selection");
  });

  it("shows the stopped items, resumed or not", async () => {
    await show({
      runs: runs([
        run({
          stoppedItems: [
            {
              repoId: "0123456789ab",
              repo: "acme/app",
              issue: 12,
              result: "stopped at run end",
              title: HOSTILE,
              link: "https://github.com/acme/app/issues/12",
              resumedBy: "2026-11-14T01:00:00.000Z",
            },
            {
              repoId: null,
              repo: "app",
              issue: 14,
              result: "in review",
              title: null,
              link: null,
              resumedBy: null,
            },
          ],
        }),
      ]),
    });
    const table = screen.getByRole("table", { name: "Unattended runs, newest first" });
    expect(table).toHaveTextContent("2 stopped items");
    const items = within(table).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(`acme/app #12 ${HOSTILE} resumed by the run of 2026-11-14`);
    expect(items[1]).toHaveTextContent("app #14 not resumed yet");
    expect(
      within(items[0] ?? document.body).getByRole("link", {
        name: "Issue 12 of acme/app in the tracker",
      }),
    ).toHaveAttribute("href", "https://github.com/acme/app/issues/12");
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows a run in progress with its window to now", async () => {
    await show({
      runs: runs([
        run({
          running: true,
          builds: 3,
          results: results({ running: 3 }),
          peak: 3,
          end: "2026-11-15T09:00:00.000Z",
        }),
      ]),
    });
    const row = within(
      screen.getByRole("table", { name: "Unattended runs, newest first" }),
    ).getAllByRole("row")[1];
    expect(row).toHaveTextContent("01:00–now");
    expect(row).toHaveTextContent("in progress");
    expect(row).toHaveTextContent("3 builds: 3 running");
  });

  it("shows two runs of one night as two rows", async () => {
    await show({ runs: runs([run({ runId: "one" }), run({ runId: "two" })]) });
    const rows = within(
      screen.getByRole("table", { name: "Unattended runs, newest first" }),
    ).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("2026-11-13");
    expect(rows[2]).toHaveTextContent("2026-11-13");
  });

  it("shows No run in the last 30 days", async () => {
    await show({ runs: runs([]) });
    expect(screen.getByText("No run in the last 30 days")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Unattended runs, newest first" })).toBeNull();
  });

  it("shows the count of skipped lines, and the unreadable folder", async () => {
    await show({ runs: runs([run()], { skipped: { nightLogLines: 2, files: 0 } }) });
    expect(screen.getByText("2 night log lines skipped: not valid.")).toBeInTheDocument();
  });

  it("shows no row and no error with no runs folder", async () => {
    await show({ runs: runs([], { sources: { runs: "missing" } }) });
    expect(screen.getByText("No run in the last 30 days")).toBeInTheDocument();
    expect(screen.queryByText("cannot read the factory folder")).toBeNull();
  });

  it("says that it cannot read the factory folder", async () => {
    await show({ runs: runs([], { sources: { runs: "unreadable" } }) });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot read the factory folder");
  });

  it("shows the next runs with the cursor", async () => {
    open();
    fakeApi();
    const cursors: (string | null)[] = [];
    server.use(
      http.get("*/api/factory-health/plugins", () => HttpResponse.json(plugins())),
      http.get("*/api/factory-health/rule-drift", () => HttpResponse.json(drift())),
      http.get("*/api/factory-health/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? runs([run({ runId: "new" })], { nextCursor: "next" })
            : runs([
                run({
                  runId: "old",
                  start: "2026-10-20T01:00:00.000Z",
                  end: "2026-10-20T02:00:00.000Z",
                }),
              ]),
        );
      }),
    );
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    expect(cursors).toContain("next");
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

  it("asks again for the three routes each 60 seconds, and not in a hidden tab", async () => {
    open();
    serve();
    renderApp();
    await screen.findByRole("table", { name: "Unattended runs, newest first" });
    const before = requests.length;
    expect(before).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(requests).toHaveLength(before + 3);
    });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(before + 3);
  });
});
