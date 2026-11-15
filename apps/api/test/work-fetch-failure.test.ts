import { schema } from "@foreman/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, entryWithoutRepo, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
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
} from "./work-fetch-fixtures.ts";

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

const APP = repoId("github.com", "acme", "app");
const OTHER = repoId("github.com", "acme", "other");
const T0 = new Date("2026-03-01T10:00:00Z");
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function setup(repos: string[] = ["acme/app"], tokens: Record<string, string> | null = null) {
  const claudeDir = await makeClaudeDir({
    repos: repos.map((repo) => entry(repo, "acme", adapterEntry)),
  });
  const adapters = await installAdapters(claudeDir);
  const tokensFile = await writeTokens(claudeDir, tokens ?? { "github.com/acme": TOKEN });
  const warnings: string[] = [];
  const fetchAt = (now: Date) =>
    runFetch({
      db: database.db,
      claudeDir,
      tokensFile,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      log: { warn: (message) => warnings.push(message) },
      now: () => now,
    });
  return { claudeDir, adapters, fetchAt, warnings };
}

async function repoRow(id: string) {
  const [row] = await database.db
    .select()
    .from(schema.workRepos)
    .where(eq(schema.workRepos.id, id));
  return row;
}

describe("a forge that fails while the tracker works", () => {
  it("writes the tracker rows and records one state for each role", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", {
      ...trackerScenario([issue(1)], [issue(1)], [release("v1.0.0", "open", [1])]),
    });
    await env.adapters.setScenario("forge", {
      "pr list --state all": { error: "HTTP 404 Not Found" },
      "pr list --state open": { error: "HTTP 404 Not Found" },
    });
    await env.fetchAt(T0);
    expect(await repoRow(APP)).toMatchObject({
      forgeState: "repo not found or no access",
      forgeErrorClass: "not_found",
      trackerState: "ok",
      trackerErrorClass: null,
    });
    expect(await database.db.select().from(schema.workIssues)).toHaveLength(1);
    expect(await database.db.select().from(schema.workReleases)).toHaveLength(1);
  });
});

describe("a token that the forge rejects", () => {
  it("keeps the cached data and the time of the last good fetch", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", trackerScenario([issue(1)], [issue(1)], []));
    await env.adapters.setScenario("forge", forgeScenario([pull(4)], [pull(4)]));
    await env.fetchAt(T0);
    const rejected = { error: "HTTP 401 Bad credentials" };
    await env.adapters.setScenario("tracker", {
      "issue list --state all": rejected,
      "issue list --state open": rejected,
      "release list --state all": rejected,
    });
    await env.adapters.setScenario("forge", {
      "pr list --state all": rejected,
      "pr list --state open": rejected,
    });
    await env.fetchAt(later(15));
    expect(await repoRow(APP)).toMatchObject({
      forgeState: "token rejected",
      trackerState: "token rejected",
      lastGoodFetchAt: T0,
    });
    expect(await database.db.select().from(schema.workIssues)).toHaveLength(1);
    expect(await database.db.select().from(schema.workPullRequests)).toHaveLength(1);
  });
});

describe("no token for an owner with cached data", () => {
  it("starts no subprocess and keeps the cached data", async () => {
    const env = await setup();
    await env.adapters.setScenario("tracker", trackerScenario([issue(1)], [issue(1)], []));
    await env.adapters.setScenario("forge", forgeScenario([pull(4)], [pull(4)]));
    await env.fetchAt(T0);
    await env.adapters.clearCalls();
    const withoutToken = await setup(["acme/app"], {});
    await withoutToken.adapters.setScenario("tracker", trackerScenario([], [], []));
    await withoutToken.adapters.setScenario("forge", forgeScenario([], []));
    await runFetch({
      db: database.db,
      claudeDir: withoutToken.claudeDir,
      tokensFile: await writeTokens(withoutToken.claudeDir, {}),
      allowedHosts: ["github.com"],
      now: () => later(15),
    });
    expect(await withoutToken.adapters.calls("tracker")).toEqual([]);
    expect(await withoutToken.adapters.calls("forge")).toEqual([]);
    expect(await repoRow(APP)).toMatchObject({
      forgeState: "not connected: no token",
      trackerState: "not connected: no token",
      lastGoodFetchAt: T0,
    });
    expect(await database.db.select().from(schema.workIssues)).toHaveLength(1);
  });
});

describe("a repo list entry with no forge name", () => {
  it("runs no adapter and writes no repo row", async () => {
    const claudeDir = await makeClaudeDir({ repos: [entryWithoutRepo("acme")] });
    const adapters = await installAdapters(claudeDir);
    const result = await runFetch({
      db: database.db,
      claudeDir,
      tokensFile: await writeTokens(claudeDir, { "github.com/acme": TOKEN }),
      allowedHosts: ["github.com"],
    });
    expect(result.repos).toBe(1);
    expect(await adapters.calls("tracker")).toEqual([]);
    expect(await adapters.calls("forge")).toEqual([]);
    expect(await database.db.select().from(schema.workRepos)).toEqual([]);
  });
});

describe("detail commands that fail", () => {
  async function detailFailure() {
    const env = await setup();
    await env.adapters.setScenario(
      "tracker",
      trackerScenario([issue(7)], [issue(7)], [release("v1.0.0", "open", [7])], {
        7: relations(7, { parent: 3, children: [8], blocked_by: [2] }),
      }),
    );
    await env.adapters.setScenario(
      "forge",
      forgeScenario([pull(4)], [pull(4)], { 4: [review("a")] }),
    );
    await env.fetchAt(T0);
    await env.adapters.setScenario("tracker", {
      ...trackerScenario(
        [issue(7, { title: "New title" })],
        [issue(7, { title: "New title" })],
        [release("v1.0.0", "released", [7])],
      ),
      "issue relations 7": { error: "HTTP 404" },
    });
    await env.adapters.setScenario("forge", {
      ...forgeScenario([pull(4)], [pull(4)], {
        4: [review("a"), review("b", { commit: "" }), review("c")],
      }),
      "release view v1.0.0": { error: "HTTP 404" },
    });
    await env.fetchAt(later(15));
    return env;
  }

  it("keeps the earlier relations, writes the lists and marks the repo partial", async () => {
    await detailFailure();
    const [row] = await database.db.select().from(schema.workIssues);
    expect(row).toMatchObject({
      title: "New title",
      parent: 3,
      children: [8],
      blockedBy: [2],
      detailsErrorClass: "not_found",
    });
    expect(await repoRow(APP)).toMatchObject({
      trackerState: "partial",
      trackerErrorClass: "not_found",
      lastGoodFetchAt: T0,
    });
  });

  it("records 'no forge release' for a release view that is not found", async () => {
    await detailFailure();
    const [row] = await database.db.select().from(schema.workForgeReleases);
    expect(row).toMatchObject({ tag: "v1.0.0", noForgeRelease: true });
  });

  it("skips the review with an empty commit, keeps the others and counts the skip", async () => {
    const env = await detailFailure();
    const rows = await database.db
      .select({ author: schema.workReviews.author })
      .from(schema.workReviews)
      .orderBy(asc(schema.workReviews.position));
    expect(rows.map((row) => row.author)).toEqual(["a", "c"]);
    const [pullRow] = await database.db.select().from(schema.workPullRequests);
    expect(pullRow).toMatchObject({ detailsErrorClass: null, detailsFetchedAt: later(15) });
    expect(env.warnings).toContain("skipped 1 review that fails the contract");
  });
});

describe("one repo that fails", () => {
  it("updates the other repo and keeps the failed repo's data and time", async () => {
    const env = await setup(["acme/app", "acme/other"]);
    const empty = forgeScenario([], []);
    await env.adapters.setScenario("forge", empty);
    await env.adapters.setScenario("tracker", {
      ...trackerScenario([issue(1)], [issue(1)], []),
      "acme/other issue list --state all": { ok: [issue(2)] },
      "acme/other issue list --state open": { ok: [issue(2)] },
      "acme/other issue relations 2": { ok: relations(2) },
    });
    await env.fetchAt(T0);
    await env.adapters.setScenario("tracker", {
      ...trackerScenario([issue(1)], [issue(1)], []),
      "acme/app issue list --state all": { error: "HTTP 401 Bad credentials" },
      "acme/other issue list --state all": { ok: [issue(2, { title: "Changed" })] },
      "acme/other issue list --state open": { ok: [issue(2, { title: "Changed" })] },
      "acme/other issue relations 2": { ok: relations(2) },
    });
    await env.fetchAt(later(15));
    const titles = await database.db
      .select({ repoId: schema.workIssues.repoId, title: schema.workIssues.title })
      .from(schema.workIssues);
    expect(titles).toContainEqual({ repoId: OTHER, title: "Changed" });
    expect(titles).toContainEqual({ repoId: APP, title: "Issue 1" });
    expect(await repoRow(APP)).toMatchObject({
      trackerState: "token rejected",
      lastGoodFetchAt: T0,
    });
    expect(await repoRow(OTHER)).toMatchObject({ trackerState: "ok", lastGoodFetchAt: later(15) });
  });
});
