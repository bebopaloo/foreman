import { writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import type { DashResponse } from "@foreman/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { gateEvent, makeFactoryDir, nightLine, NOW, writeJsonl } from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

async function clear(): Promise<void> {
  await database.db.delete(schema.workRepos);
}

beforeAll(async () => {
  database = await openTestDatabase();
});
beforeEach(clear);
afterAll(async () => {
  await clear();
  await database.close();
});

const DAY = "2026-11-15";
const entry = (repo: string, client: string) => ({ path: `/synthetic/${repo}`, repo, client });
const APP = entry("acme/app", "acme");
const SITE = entry("acme/site", "acme");
const PORTAL = entry("globex/portal", "globex");
const DATA_AS_OF = new Date("2026-11-15T11:50:00Z");

async function cacheRepo(
  fullName: string,
  states: { forge: string | null; tracker: string | null },
  lastGoodFetchAt: Date | null = DATA_AS_OF,
) {
  const [owner = "", name = ""] = fullName.split("/");
  await database.db.insert(schema.workRepos).values({
    id: repoId("github.com", owner, name),
    host: "github.com",
    owner,
    name,
    forgeState: states.forge,
    trackerState: states.tracker,
    lastGoodFetchAt,
  });
}

async function dash(
  entries: object[],
  options: {
    client?: string;
    lines?: Record<string, unknown>[];
    events?: Record<string, unknown>[];
  } = {},
): Promise<DashResponse> {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify({ repos: entries }));
  if (options.lines !== undefined) await writeJsonl(factory, "runs", DAY, options.lines);
  if (options.events !== undefined) await writeJsonl(factory, "controls", DAY, options.events);
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
    db: database.db,
    logger: false,
    now: () => NOW,
  });
  const query = options.client === undefined ? "" : `?client=${options.client}`;
  const response = await app.inject({ method: "GET", url: `/api/dash${query}` });
  await app.close();
  expect(response.statusCode).toBe(200);
  return response.json<DashResponse>();
}

describe("GET /api/dash repos", () => {
  it("lists each repo with its client, state, data as of and last log and Control times", async () => {
    await cacheRepo("acme/app", { forge: "ok", tracker: "ok" });
    await cacheRepo(
      "acme/site",
      { forge: "not connected: no token", tracker: "not connected: no token" },
      null,
    );
    const body = await dash([APP, SITE, PORTAL], {
      lines: [
        nightLine({ repo: APP.path, time: "2026-11-15T08:00:00Z" }),
        nightLine({ repo: APP.path, issue: 13, time: "2026-11-15T09:30:00Z" }),
        nightLine({ repo: "/synthetic/elsewhere", time: "2026-11-15T11:00:00Z" }),
      ],
      events: [
        gateEvent({ repo: "acme/app", time: "2026-11-15T10:00:00Z" }),
        gateEvent({ repo: "Acme/App", pr: 41, time: "2026-11-15T10:45:00Z" }),
        gateEvent({ repo: "acme/site", time: "2026-11-15T07:00:00Z", pr: 2 }),
      ],
    });
    expect(body.repos).toEqual([
      {
        repoId: repoId("github.com", "acme", "app"),
        repo: "acme/app",
        client: "acme",
        state: "connected",
        dataAsOf: DATA_AS_OF.toISOString(),
        lastLogAt: "2026-11-15T09:30:00.000Z",
        lastControlAt: "2026-11-15T10:45:00.000Z",
      },
      {
        repoId: repoId("github.com", "acme", "site"),
        repo: "acme/site",
        client: "acme",
        state: "not connected: no token",
        dataAsOf: null,
        lastLogAt: null,
        lastControlAt: "2026-11-15T07:00:00.000Z",
      },
      {
        repoId: repoId("github.com", "globex", "portal"),
        repo: "globex/portal",
        client: "globex",
        state: "not fetched",
        dataAsOf: null,
        lastLogAt: null,
        lastControlAt: null,
      },
    ]);
  });

  it("shows the first state that is not connected, and partial for a partial fetch", async () => {
    await cacheRepo("acme/app", { forge: "ok", tracker: "partial" });
    await cacheRepo("acme/site", { forge: "ok", tracker: "token rejected" });
    await cacheRepo("globex/portal", { forge: "not configured", tracker: "ok" });
    const body = await dash([APP, SITE, PORTAL]);
    expect(body.repos.map((repo) => repo.state)).toEqual([
      "partial",
      "token rejected",
      "connected",
    ]);
  });

  it("lists a repo with no forge name by its folder name, as not connected", async () => {
    const unnamed = {
      path: "/synthetic/local-only",
      forge: "github",
      tracker: "github",
      enabled: true,
    };
    const body = await dash([APP, unnamed]);
    expect(body.repos.map((repo) => [repo.repo, repo.state])).toEqual([
      ["acme/app", "not fetched"],
      ["local-only", "not connected: no forge name"],
    ]);
    expect(body.repos[1]).toMatchObject({ client: null, dataAsOf: null });
    expect(body.complete).toEqual({ connectedRepos: 0, missingRepos: 1 });
  });

  it("keeps a repo with no forge name out of a client scope of another client", async () => {
    const unnamed = {
      path: "/synthetic/local-only",
      forge: "github",
      tracker: "github",
      client: "acme",
    };
    const other = await dash([APP, unnamed], { client: "globex" });
    expect(other.repos).toEqual([]);
    const same = await dash([APP, unnamed], { client: "acme" });
    expect(same.repos.map((repo) => repo.repo)).toEqual(["acme/app", "local-only"]);
  });

  it("lists only the repos of the client in a client scope", async () => {
    const body = await dash([APP, SITE, PORTAL], { client: "globex" });
    expect(body.repos.map((repo) => repo.repo)).toEqual(["globex/portal"]);
  });
});
