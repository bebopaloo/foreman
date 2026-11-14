import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { runFetch } from "../src/work/fetch.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, entryWithoutRepo, makeClaudeDir } from "./repo-list-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table work_repos, work_fetch_runs`);
});

async function appFor(repoList?: unknown) {
  const claudeDir = await makeClaudeDir(repoList);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
  const app = await buildApp({ config, db: database.db, logger: false });
  return { app, claudeDir };
}

describe("GET /api/work/clients", () => {
  it("returns each client with its repo count and the unassigned count", async () => {
    const { app } = await appFor({
      repos: [
        entry("acme/a", "acme"),
        entry("acme/b", "acme"),
        entry("bebopaloo/c", "bebopaloo"),
        entry("misc/d"),
      ],
    });
    const response = await app.inject({ method: "GET", url: "/api/work/clients" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      clients: [
        { name: "acme", repoCount: 2 },
        { name: "bebopaloo", repoCount: 1 },
      ],
      unassignedCount: 1,
    });
    await app.close();
  });

  it("returns no clients when there is no repo list", async () => {
    const { app } = await appFor();
    const response = await app.inject({ method: "GET", url: "/api/work/clients" });
    expect(response.json()).toEqual({ clients: [], unassignedCount: 0 });
    await app.close();
  });

  it("returns no clients when the repo list is not readable", async () => {
    const { app } = await appFor("{");
    const response = await app.inject({ method: "GET", url: "/api/work/clients" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clients: [], unassignedCount: 0 });
    await app.close();
  });
});

describe("GET /api/work/repos", () => {
  it("returns each repo sorted by name with its ID, host and client", async () => {
    const { app } = await appFor({
      repos: [entry("acme/zed", "acme"), entry("acme/app", "acme"), entry("misc/d")],
    });
    const response = await app.inject({ method: "GET", url: "/api/work/repos" });
    const body = response.json<{ repos: Record<string, unknown>[] }>();
    expect(body.repos.map((repo) => repo.fullName)).toEqual(["acme/app", "acme/zed", "misc/d"]);
    expect(body.repos[0]).toMatchObject({
      host: "github.com",
      client: "acme",
      dataAsOf: null,
    });
    expect(body.repos[0]?.id).toMatch(/^[0-9a-f]{12}$/);
    expect(body.repos[2]?.client).toBeNull();
    await app.close();
  });
});

describe("an entry with no repo field", () => {
  it("shows in the repos and the client counts as not connected", async () => {
    const { app } = await appFor({ repos: [entryWithoutRepo("acme")] });
    const repos = await app.inject({ method: "GET", url: "/api/work/repos" });
    expect(repos.json()).toMatchObject({
      repos: [{ client: "acme", state: "not connected: no forge name" }],
    });
    const clients = await app.inject({ method: "GET", url: "/api/work/clients" });
    expect(clients.json()).toEqual({
      clients: [{ name: "acme", repoCount: 1 }],
      unassignedCount: 0,
    });
    await app.close();
  });
});

describe("GET /api/work/status", () => {
  it("names an invalid entry by position and field, with no value", async () => {
    const { app, claudeDir } = await appFor({
      repos: [entry("acme/app", "acme"), entry("acme/bad", "bad client")],
    });
    await runFetch({ db: database.db, claudeDir });
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "idle",
      reason: null,
      problems: [{ position: 1, field: "client" }],
    });
    expect(response.body).not.toContain("bad client");
    await app.close();
  });

  it("shows the reason of the last fetch when there is no repo list", async () => {
    const { app, claudeDir } = await appFor();
    await runFetch({ db: database.db, claudeDir });
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    expect(response.json()).toMatchObject({ state: "idle", reason: "no repo list" });
    await app.close();
  });

  it("shows idle with no reason before the first fetch", async () => {
    const { app } = await appFor({ repos: [] });
    const response = await app.inject({ method: "GET", url: "/api/work/status" });
    expect(response.json()).toMatchObject({ state: "idle", reason: null, lastFetchAt: null });
    await app.close();
  });
});
