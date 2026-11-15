import { schema } from "@foreman/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
  BODY_TEXT,
  forgeRelease,
  forgeScenario,
  installAdapters,
  issue,
  pull,
  relations,
  release,
  review,
  TOKEN,
  trackerScenario,
  writeTokens,
  type Scenario,
} from "./work-fetch-fixtures.ts";

// Each fetch runs one real `uv run` subprocess per adapter call, and a test makes
// up to two or three fetches of six or more calls. A cold `uv` start takes 0.2 to
// 0.5 s when other test runs share the machine, so such a test can pass the 5 s
// default of Vitest. 30 s is well above the worst time seen under load. A hung
// adapter call still ends at its own 20 s timeout, so a real hang still fails.
vi.setConfig({ testTimeout: 30_000 });

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases, work_fetch_runs`,
  );
});

const REPO = repoId("github.com", "acme", "app");
const T0 = new Date("2026-03-01T10:00:00Z");
const minutes = (start: Date, count: number) => new Date(start.getTime() + count * 60_000);
const hours = (start: Date, count: number) => minutes(start, count * 60);

async function setup(
  options: { tokens?: Record<string, string> | null; roles?: ("tracker" | "forge")[] } = {},
) {
  const claudeDir = await makeClaudeDir({
    repos: [entry("acme/app", "acme", adapterEntry)],
  });
  const adapters = await installAdapters(claudeDir, options.roles);
  const tokensFile =
    options.tokens === null
      ? undefined
      : await writeTokens(claudeDir, options.tokens ?? { "github.com/acme": TOKEN });
  const fetchAt = (now: Date) =>
    runFetch({
      db: database.db,
      claudeDir,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      now: () => now,
      ...(tokensFile === undefined ? {} : { tokensFile }),
    });
  return { claudeDir, adapters, fetchAt };
}

async function repoRow() {
  const [row] = await database.db.select().from(schema.workRepos);
  return row;
}

async function issueRows() {
  return database.db.select().from(schema.workIssues).orderBy(asc(schema.workIssues.number));
}

const sorted = (values: string[]) => [...values].sort();

async function firstFetch() {
  const env = await setup();
  await env.adapters.setScenario(
    "tracker",
    trackerScenario(
      [issue(3, { state: "closed" }), issue(2), issue(1)],
      [issue(2), issue(1)],
      [release("v1.2.0", "released", [1]), release("v1.3.0", "open", [2])],
    ),
  );
  await env.adapters.setScenario(
    "forge",
    forgeScenario(
      [pull(5, { state: "merged" }), pull(4)],
      [pull(4)],
      { 4: [review("synth-factory"), review("synth-factory"), review("synth-operator")] },
      { "v1.2.0": forgeRelease("v1.2.0") },
    ),
  );
  const result = await env.fetchAt(T0);
  return { ...env, result };
}

describe("the first fetch", () => {
  it("runs the five lists once each, then the details of every item", async () => {
    const { adapters } = await firstFetch();
    expect(sorted(await adapters.calls("tracker"))).toEqual(
      sorted([
        "issue list --state all",
        "issue list --state open",
        "release list --state all",
        "issue relations 1",
        "issue relations 2",
        "issue relations 3",
      ]),
    );
    expect(sorted(await adapters.calls("forge"))).toEqual(
      sorted([
        "repo",
        "file get .claude/factory.json --ref main",
        "pr list --state all",
        "pr list --state open",
        "pr reviews 4",
        "pr reviews 5",
        "release view v1.2.0",
      ]),
    );
  });

  it("keeps no issue body and no review body", async () => {
    await firstFetch();
    const tables = [
      schema.workIssues,
      schema.workPullRequests,
      schema.workReviews,
      schema.workReleases,
      schema.workForgeReleases,
    ];
    for (const table of tables) {
      const rows = await database.db.select().from(table);
      expect(JSON.stringify(rows)).not.toContain(BODY_TEXT);
    }
    expect(await issueRows()).toHaveLength(3);
  });

  it("records the run as full, with its adapter calls", async () => {
    const { result } = await firstFetch();
    expect(result).toMatchObject({ state: "idle", repos: 1 });
    const [run] = await database.db.select().from(schema.workFetchRuns);
    expect(run).toMatchObject({ kind: "full", state: "idle", reposRead: 1, adapterCalls: 13 });
  });

  it("writes the repo states and the 'data as of' time", async () => {
    await firstFetch();
    expect(await repoRow()).toMatchObject({
      forgeState: "ok",
      trackerState: "ok",
      forgeErrorClass: null,
      trackerErrorClass: null,
      lastGoodFetchAt: T0,
    });
  });

  it("caches the fields and the relations of an issue", async () => {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([issue(7, { labels: ["a", "b"] })], [issue(7, { labels: ["a", "b"] })], [], {
        7: relations(7, { parent: 2, children: [8, 9], blocked_by: [3] }),
      }),
    );
    await env.adapters.setScenario("forge", forgeScenario([], []));
    await env.fetchAt(T0);
    expect(await issueRows()).toEqual([
      {
        repoId: REPO,
        number: 7,
        title: "Issue 7",
        state: "open",
        issueState: "READY",
        priority: "high",
        labels: ["a", "b"],
        author: "synth-author",
        link: "https://github.com/acme/app/issues/7",
        parent: 2,
        children: [8, 9],
        blockedBy: [3],
        lastListedAt: T0,
        detailsFetchedAt: T0,
        detailsErrorClass: null,
      },
    ]);
  });
});

describe("reviews without text", () => {
  it("caches 3 reviews with author, state, commit and time", async () => {
    await firstFetch();
    const rows = await database.db
      .select()
      .from(schema.workReviews)
      .orderBy(asc(schema.workReviews.position));
    expect(rows.map((row) => [row.author, row.state, row.commit, row.time.toISOString()])).toEqual([
      ["synth-factory", "APPROVED", "abc1234", "2026-01-02T03:04:05.000Z"],
      ["synth-factory", "APPROVED", "abc1234", "2026-01-02T03:04:05.000Z"],
      ["synth-operator", "APPROVED", "abc1234", "2026-01-02T03:04:05.000Z"],
    ]);
  });

  it("replaces the reviews of a pull request on the next fetch", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario(
      "forge",
      forgeScenario([pull(5, { state: "merged" }), pull(4)], [pull(4)], {
        4: [review("synth-operator", { state: "CHANGES_REQUESTED" })],
      }),
    );
    await fetchAt(minutes(T0, 15));
    const rows = await database.db.select().from(schema.workReviews);
    expect(rows.map((row) => row.state)).toEqual(["CHANGES_REQUESTED"]);
  });

  it("skips a review with a time that is not a date", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", trackerScenario([], [], []));
    await env.adapters.setScenario(
      "forge",
      forgeScenario([pull(1)], [pull(1)], {
        1: [review("a", { time: "not a date" }), review("b")],
      }),
    );
    await env.fetchAt(T0);
    const rows = await database.db.select().from(schema.workReviews);
    expect(rows.map((row) => row.author)).toEqual(["b"]);
  });
});

describe("a later fetch", () => {
  it("gets relations and reviews for open items only, and no release view", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.clearCalls();
    await fetchAt(minutes(T0, 15));
    expect(sorted(await adapters.calls("tracker"))).toEqual(
      sorted([
        "issue list --state all",
        "issue list --state open",
        "release list --state all",
        "issue relations 1",
        "issue relations 2",
      ]),
    );
    expect(sorted(await adapters.calls("forge"))).toEqual(
      sorted(["pr list --state all", "pr list --state open", "pr reviews 4"]),
    );
    const [run] = await database.db
      .select()
      .from(schema.workFetchRuns)
      .orderBy(asc(schema.workFetchRuns.startedAt))
      .offset(1);
    expect(run?.kind).toBe("incremental");
  });

  it("gets the details of a closed item again when its labels change", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario(
      "tracker",
      trackerScenario(
        [issue(3, { state: "closed", labels: ["other"] }), issue(2), issue(1)],
        [issue(2), issue(1)],
        [release("v1.2.0", "released", [1])],
      ),
    );
    await adapters.clearCalls();
    await fetchAt(minutes(T0, 15));
    expect(await adapters.calls("tracker")).toContain("issue relations 3");
  });

  it("gets the details of every listed item in a fetch after 24 hours", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.clearCalls();
    await fetchAt(hours(T0, 25));
    expect(await adapters.calls("tracker")).toContain("issue relations 3");
    expect(await adapters.calls("forge")).toContain("pr reviews 5");
    const runs = await database.db
      .select()
      .from(schema.workFetchRuns)
      .orderBy(asc(schema.workFetchRuns.startedAt));
    expect(runs.map((run) => run.kind)).toEqual(["full", "full"]);
  });
});

describe("an issue that closed", () => {
  it("gets relations once for an issue that was open and is closed now", async () => {
    const { adapters, fetchAt } = await firstFetch();
    const closedNow = [issue(3, { state: "closed" }), issue(2, { state: "closed" }), issue(1)];
    await adapters.setScenario(
      "tracker",
      trackerScenario(closedNow, [issue(1)], [release("v1.2.0", "released", [1])]),
    );
    await adapters.clearCalls();
    await fetchAt(minutes(T0, 15));
    expect(
      (await adapters.calls("tracker")).filter((call) => call === "issue relations 2"),
    ).toHaveLength(1);

    await adapters.clearCalls();
    await fetchAt(minutes(T0, 30));
    expect(await adapters.calls("tracker")).not.toContain("issue relations 2");
    expect(await adapters.calls("tracker")).toContain("issue relations 1");
  });

  it("gets relations once for a closed issue that has no cached row", async () => {
    const { adapters, fetchAt } = await firstFetch();
    const all = [issue(9, { state: "closed" }), issue(3, { state: "closed" }), issue(2), issue(1)];
    await adapters.setScenario(
      "tracker",
      trackerScenario(all, [issue(2), issue(1)], [release("v1.2.0", "released", [1])]),
    );
    await adapters.clearCalls();
    await fetchAt(minutes(T0, 15));
    const calls = await adapters.calls("tracker");
    expect(calls.filter((call) => call === "issue relations 9")).toHaveLength(1);
    expect(calls).not.toContain("issue relations 3");
  });

  it("tries a closed issue again when its first details call failed", async () => {
    const env = await setup();
    const scenario = trackerScenario([issue(1, { state: "closed" })], [], []);
    scenario["issue relations 1"] = { error: "HTTP 404" };
    await env.adapters.setScenario("tracker", scenario);
    await env.adapters.setScenario("forge", forgeScenario([], []));
    await env.fetchAt(T0);
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([issue(1, { state: "closed" })], [], []),
    );
    await env.adapters.clearCalls();
    await env.fetchAt(minutes(T0, 15));
    expect(await env.adapters.calls("tracker")).toContain("issue relations 1");
    expect((await issueRows())[0]?.detailsErrorClass).toBeNull();
  });
});

describe("an item that drops out of a list", () => {
  it("keeps the cached issue with its last data and its old listed time", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario(
      "tracker",
      trackerScenario([issue(2), issue(1)], [issue(2), issue(1)], [release("v1.2.0", "released")]),
    );
    await fetchAt(minutes(T0, 15));
    const rows = await issueRows();
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
    const dropped = rows.find((row) => row.number === 3);
    expect(dropped).toMatchObject({ title: "Issue 3", state: "closed", lastListedAt: T0 });
    expect(rows.find((row) => row.number === 1)?.lastListedAt).toEqual(minutes(T0, 15));
  });

  it("updates an open issue that only the open list reaches", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario(
      "tracker",
      trackerScenario(
        [issue(2), issue(3, { state: "closed" })],
        [issue(1, { title: "Oldest, renamed" }), issue(2)],
        [release("v1.2.0", "released")],
      ),
    );
    await fetchAt(minutes(T0, 15));
    const oldest = (await issueRows()).find((row) => row.number === 1);
    expect(oldest).toMatchObject({
      title: "Oldest, renamed",
      state: "open",
      lastListedAt: minutes(T0, 15),
    });
  });
});

describe("a released Release", () => {
  it("gets release view for the released one only, and caches tag, target and assets", async () => {
    const { adapters } = await firstFetch();
    expect(await adapters.calls("forge")).toContain("release view v1.2.0");
    expect(await adapters.calls("forge")).not.toContain("release view v1.3.0");
    const forgeRows = await database.db.select().from(schema.workForgeReleases);
    expect(forgeRows).toEqual([
      {
        repoId: REPO,
        tag: "v1.2.0",
        targetCommit: "deadbeef",
        assetNames: ["app.tgz"],
        link: "https://github.com/acme/app/releases/tag/v1.2.0",
        noForgeRelease: false,
      },
    ]);
    const releases = await database.db
      .select()
      .from(schema.workReleases)
      .orderBy(asc(schema.workReleases.name));
    expect(releases.map((row) => [row.name, row.state, row.issueNumbers])).toEqual([
      ["v1.2.0", "released", [1]],
      ["v1.3.0", "open", [2]],
    ]);
  });

  it("records 'no forge release' for not_found, and tries again only in a full fetch", async () => {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([], [], [release("v1.0.0", "released")]),
    );
    const forge = forgeScenario([], []);
    forge["release view v1.0.0"] = { error: "HTTP 404 Not Found" };
    await env.adapters.setScenario("forge", forge);
    await env.fetchAt(T0);
    const [row] = await database.db.select().from(schema.workForgeReleases);
    expect(row).toMatchObject({ tag: "v1.0.0", noForgeRelease: true, targetCommit: null });

    await env.adapters.clearCalls();
    await env.fetchAt(minutes(T0, 15));
    expect(await env.adapters.calls("forge")).not.toContain("release view v1.0.0");

    await env.adapters.clearCalls();
    await env.fetchAt(hours(T0, 25));
    expect(await env.adapters.calls("forge")).toContain("release view v1.0.0");
  });

  it("makes the forge partial and records nothing when release view fails otherwise", async () => {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([], [], [release("v1.0.0", "released")]),
    );
    const forge = forgeScenario([], []);
    forge["release view v1.0.0"] = { error: "something broke" };
    await env.adapters.setScenario("forge", forge);
    await env.fetchAt(T0);
    expect(await database.db.select().from(schema.workForgeReleases)).toEqual([]);
    expect(await repoRow()).toMatchObject({ forgeState: "partial", forgeErrorClass: "other" });
  });

  it("skips a Release name that is not a release tag", async () => {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([], [], [release("next", "released")]),
    );
    await env.adapters.setScenario("forge", forgeScenario([], []));
    await env.fetchAt(T0);
    expect(await env.adapters.calls("forge")).not.toContain("release view next");
  });
});

describe("links", () => {
  it("keeps only an https link on the host of the repo", async () => {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario(
        [
          issue(1, { url: "http://github.com/acme/app/issues/1" }),
          issue(2, { url: "https://evil.example/acme/app/issues/2" }),
          issue(3, { url: "https://user:pw@github.com/acme/app/issues/3" }),
          issue(4, { url: "https://github.com:8443/acme/app/issues/4" }),
          issue(5, { url: "not a url" }),
          issue(6),
        ],
        [],
        [],
      ),
    );
    await env.adapters.setScenario("forge", forgeScenario([], []));
    await env.fetchAt(T0);
    expect((await issueRows()).map((row) => row.link)).toEqual([
      null,
      null,
      null,
      null,
      null,
      "https://github.com/acme/app/issues/6",
    ]);
  });
});

describe("a role that cannot run", () => {
  it("runs no adapter and writes 'not connected: no token' with no token", async () => {
    const env = await setup({ tokens: null });
    await env.fetchAt(T0);
    expect(await env.adapters.calls("tracker")).toEqual([]);
    expect(await env.adapters.calls("forge")).toEqual([]);
    expect(await repoRow()).toMatchObject({
      forgeState: "not connected: no token",
      trackerState: "not connected: no token",
      lastGoodFetchAt: null,
    });
  });

  it("refuses a token that does not have the adapter's prefix", async () => {
    const env = await setup({ tokens: { "github.com/acme": "ghp_classic_token" } });
    await env.fetchAt(T0);
    expect(await env.adapters.calls("tracker")).toEqual([]);
    expect((await repoRow())?.trackerState).toBe("token refused: not a fine-grained token");
  });

  it("writes 'adapter not readable by Foreman' when the plugin is not installed", async () => {
    const env = await setup({ roles: ["tracker"] });
    await env.adapters.setScenario("tracker", trackerScenario([issue(1)], [issue(1)], []));
    await env.fetchAt(T0);
    expect(await repoRow()).toMatchObject({
      forgeState: "adapter not readable by Foreman",
      trackerState: "ok",
    });
    expect(await issueRows()).toHaveLength(1);
  });

  it("marks a role with no plugin as not configured and still sets the 'data as of' time", async () => {
    const claudeDir = await makeClaudeDir({
      repos: [entry("acme/app", "acme", { forge: undefined, tracker: adapterEntry.tracker })],
    });
    const adapters = await installAdapters(claudeDir, ["tracker"]);
    await adapters.setScenario("tracker", trackerScenario([], [], []));
    const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
    await runFetch({
      db: database.db,
      claudeDir,
      tokensFile,
      allowedHosts: ["github.com"],
      now: () => T0,
    });
    expect(await repoRow()).toMatchObject({
      forgeState: "not configured",
      trackerState: "ok",
      lastGoodFetchAt: T0,
    });
  });

  it("runs no adapter for a host that is not allowed", async () => {
    const env = await setup();
    await runFetch({
      db: database.db,
      claudeDir: env.claudeDir,
      tokensFile: await writeTokens(env.claudeDir, { "github.com/acme": TOKEN }),
      allowedHosts: ["other.example"],
      now: () => T0,
    });
    expect(await env.adapters.calls("tracker")).toEqual([]);
    expect((await repoRow())?.trackerState).toBe("host not allowed");
  });
});

describe("a failed adapter", () => {
  async function failTracker(error: string) {
    const env = await firstFetch();
    const failing: Scenario = {
      ...trackerScenario([issue(1, { title: "New title" })], [issue(1)], []),
      "issue list --state open": { error },
    };
    await env.adapters.setScenario("tracker", failing);
    await env.adapters.setScenario(
      "forge",
      forgeScenario(
        [pull(4, { title: "New pull title" })],
        [pull(4, { title: "New pull title" })],
        {
          4: [review("synth-new")],
        },
      ),
    );
    await env.fetchAt(minutes(T0, 15));
    return env;
  }

  it("keeps the cached tracker rows, still writes the forge rows, and keeps the old time", async () => {
    await failTracker("HTTP 401 Bad credentials");
    expect(await repoRow()).toMatchObject({
      trackerState: "token rejected",
      trackerErrorClass: "auth",
      forgeState: "ok",
      lastGoodFetchAt: T0,
    });
    const rows = await issueRows();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.number === 1)?.title).toBe("Issue 1");
    const [pullRow] = await database.db
      .select()
      .from(schema.workPullRequests)
      .where(eq(schema.workPullRequests.number, 4));
    expect(pullRow?.title).toBe("New pull title");
  });

  it("maps an error text to its error class", async () => {
    await failTracker("API rate limit exceeded");
    expect((await repoRow())?.trackerErrorClass).toBe("rate_limit");
  });

  it("keeps the cached details of an issue whose relations call failed, and marks the class", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario("tracker", {
      ...trackerScenario([issue(1), issue(2)], [issue(1), issue(2)], []),
      "issue relations 1": { error: "request timed out" },
    });
    await fetchAt(minutes(T0, 15));
    const one = (await issueRows()).find((row) => row.number === 1);
    expect(one).toMatchObject({
      detailsErrorClass: "timeout",
      detailsFetchedAt: T0,
      lastListedAt: minutes(T0, 15),
    });
    expect(await repoRow()).toMatchObject({
      trackerState: "partial",
      trackerErrorClass: "timeout",
      lastGoodFetchAt: T0,
    });
  });

  it("marks a pull request whose reviews call failed", async () => {
    const { adapters, fetchAt } = await firstFetch();
    await adapters.setScenario("forge", {
      ...forgeScenario([pull(4)], [pull(4)]),
      "pr reviews 4": { error: "HTTP 404" },
    });
    await fetchAt(minutes(T0, 15));
    const [row] = await database.db
      .select()
      .from(schema.workPullRequests)
      .where(eq(schema.workPullRequests.number, 4));
    expect(row).toMatchObject({ detailsErrorClass: "not_found" });
    expect(await database.db.select().from(schema.workReviews)).toHaveLength(3);
    expect((await repoRow())?.forgeState).toBe("partial");
  });

  it("writes invalid adapter output as a failed role", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", {
      "issue list --state all": { ok: [{ number: 1 }] },
    });
    await env.adapters.setScenario("forge", forgeScenario([], []));
    await env.fetchAt(T0);
    expect(await repoRow()).toMatchObject({
      trackerState: "invalid adapter output",
      trackerErrorClass: "invalid_output",
    });
  });

  it("fails the forge role when the open pull request list fails", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", trackerScenario([], [], []));
    await env.adapters.setScenario("forge", {
      "pr list --state all": { ok: [] },
      "pr list --state open": { error: "HTTP 401" },
    });
    await env.fetchAt(T0);
    expect(await repoRow()).toMatchObject({ forgeState: "token rejected", trackerState: "ok" });
  });
});

describe("a repo that the list no longer names", () => {
  it("deletes its rows in every work table", async () => {
    const { claudeDir } = await firstFetch();
    const other = await makeClaudeDir({ repos: [entry("acme/other", "acme")] });
    await runFetch({ db: database.db, claudeDir: other, now: () => minutes(T0, 15) });
    expect(claudeDir).not.toBe(other);
    for (const table of [
      schema.workRepos,
      schema.workIssues,
      schema.workPullRequests,
      schema.workReviews,
      schema.workReleases,
      schema.workForgeReleases,
    ]) {
      const rows = await database.db.select().from(table);
      expect(rows.every((row) => !("repoId" in row) || row.repoId !== REPO)).toBe(true);
    }
    expect(await database.db.select().from(schema.workIssues)).toEqual([]);
  });
});
