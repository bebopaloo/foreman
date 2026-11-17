import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import type { FetchSchedule, FetchState } from "../src/work/schedule.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
  forgeScenario,
  installAdapters,
  issue,
  pull,
  TOKEN,
  trackerScenario,
  writeTokens,
} from "./work-fetch-fixtures.ts";
import { createFetchSchedule } from "../src/work/schedule.ts";

// A fetch runs one real `uv run` subprocess per adapter call. A cold `uv` start
// takes 0.2 to 0.5 s when other test runs share the machine, so a test with a
// full fetch can pass the 5 s default of Vitest. A hung adapter call still ends
// at its own 20 s timeout.
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

function fakeSchedule(state: FetchState = { state: "running", reason: null }) {
  const seen = { triggers: 0, refreshes: 0 };
  const schedule: FetchSchedule = {
    trigger: (request) => {
      seen.triggers += 1;
      if (request?.refresh === true) seen.refreshes += 1;
      return Promise.resolve();
    },
    state: () => state,
    start: () => undefined,
    stop: () => Promise.resolve(),
  };
  return { seen, schedule };
}

async function appWith(fetcher: FetchSchedule, repoList: unknown = { repos: [] }) {
  const claudeDir = await makeClaudeDir(repoList);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
  return buildApp({ config, db: database.db, logger: false, fetcher });
}

describe("POST /api/work/refresh", () => {
  it("starts a fetch and returns the fetch in progress with status 202", async () => {
    const { schedule, seen } = fakeSchedule();
    const app = await appWith(schedule);
    const response = await app.inject({ method: "POST", url: "/api/work/refresh" });
    await app.close();
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ state: "running" });
    expect(seen.triggers).toBe(1);
    expect(seen.refreshes).toBe(1);
  });

  it("accepts an Origin that is in the allow-list", async () => {
    const { schedule, seen } = fakeSchedule();
    const app = await appWith(schedule);
    const response = await app.inject({
      method: "POST",
      url: "/api/work/refresh",
      headers: { origin: testConfig.CORS_ORIGINS[0] ?? "" },
    });
    await app.close();
    expect(response.statusCode).toBe(202);
    expect(seen.triggers).toBe(1);
  });

  it("rejects an Origin that is not in the allow-list with 403 and starts no fetch", async () => {
    const { schedule, seen } = fakeSchedule();
    const app = await appWith(schedule);
    const response = await app.inject({
      method: "POST",
      url: "/api/work/refresh",
      headers: { origin: "http://evil.example" },
    });
    await app.close();
    expect(response.statusCode).toBe(403);
    expect(seen.triggers).toBe(0);
  });

  it("returns the same fetch in progress for a second request", async () => {
    const claudeDir = await makeClaudeDir({ repos: [] });
    const schedule = createFetchSchedule({
      db: database.db,
      claudeDir,
      intervalMs: 60_000,
      log: { info: () => undefined, warn: () => undefined },
    });
    const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
    const app = await buildApp({ config, db: database.db, logger: false, fetcher: schedule });
    const [one, two] = await Promise.all([
      app.inject({ method: "POST", url: "/api/work/refresh" }),
      app.inject({ method: "POST", url: "/api/work/refresh" }),
    ]);
    await app.close();
    expect(one.statusCode).toBe(202);
    expect(two.statusCode).toBe(202);
    expect(await database.db.execute(sql`select count(*)::int as n from work_fetch_runs`)).toEqual([
      { n: 1 },
    ]);
  });
});

describe("GET /api/work/status", () => {
  it("shows running while the fetch runs", async () => {
    const { schedule } = fakeSchedule();
    const app = await appWith(schedule);
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    await app.close();
    expect(response.json()).toMatchObject({ state: "running", reason: null });
  });

  it("shows the failed state with its reason", async () => {
    const { schedule } = fakeSchedule({ state: "failed", reason: "The fetch failed." });
    const app = await appWith(schedule);
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    await app.close();
    expect(response.json()).toMatchObject({ state: "failed", reason: "The fetch failed." });
  });

  it("shows the connection state of each owner and each repo after a fetch", async () => {
    const claudeDir = await makeClaudeDir({
      repos: [entry("acme/app", "acme", adapterEntry), entry("nokey/app", "nokey", adapterEntry)],
    });
    const adapters = await installAdapters(claudeDir);
    await adapters.setScenario("tracker", trackerScenario([issue(1)], [issue(1)], []));
    await adapters.setScenario("forge", forgeScenario([pull(4)], [pull(4)]));
    const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
    const schedule = createFetchSchedule({
      db: database.db,
      claudeDir,
      tokenSource: tokensFile,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      intervalMs: 60_000,
      log: { info: () => undefined, warn: () => undefined },
    });
    const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
    const app = await buildApp({ config, db: database.db, logger: false, fetcher: schedule });

    await schedule.trigger();
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    await app.close();

    const body = response.json<{
      state: string;
      owners: unknown[];
      repos: Record<string, unknown>[];
      lastFullFetchAt: string | null;
      lastFetchStartedAt: string | null;
    }>();
    expect(body.state).toBe("idle");
    expect(body.owners).toEqual([
      { host: "github.com", owner: "acme", state: "connected" },
      { host: "github.com", owner: "nokey", state: "not connected: no token" },
    ]);
    expect(body.repos.find((repo) => repo.fullName === "acme/app")).toMatchObject({
      forgeState: "ok",
      trackerState: "ok",
    });
    expect(body.repos.find((repo) => repo.fullName === "nokey/app")).toMatchObject({
      forgeState: "not connected: no token",
      trackerState: "not connected: no token",
      dataAsOf: null,
    });
    expect(body.lastFullFetchAt).not.toBeNull();
    expect(body.lastFetchStartedAt).not.toBeNull();
    expect(response.body).not.toContain(TOKEN);
  });

  it("shows token rejected for an owner whose token the forge rejects", async () => {
    const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme", adapterEntry)] });
    const adapters = await installAdapters(claudeDir);
    const rejected = { error: "HTTP 401 Bad credentials" };
    await adapters.setScenario("tracker", { "issue list --state all": rejected });
    await adapters.setScenario("forge", { "pr list --state all": rejected });
    const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
    const schedule = createFetchSchedule({
      db: database.db,
      claudeDir,
      tokenSource: tokensFile,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      intervalMs: 60_000,
      log: { info: () => undefined, warn: () => undefined },
    });
    const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
    const app = await buildApp({ config, db: database.db, logger: false, fetcher: schedule });
    await schedule.trigger();
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    await app.close();
    expect(response.json()).toMatchObject({
      owners: [{ host: "github.com", owner: "acme", state: "token rejected" }],
    });
  });
});
