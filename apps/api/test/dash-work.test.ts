import { writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import type { DashResponse } from "@foreman/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import {
  gateEvent,
  makeFactoryDir,
  nightLine,
  NOW,
  writeJsonl,
  writeLock,
} from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

async function clear(): Promise<void> {
  await database.db.delete(schema.workPullRequests);
  await database.db.delete(schema.workIssues);
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
const at = (clock: string): string => `${DAY}T${clock}:00Z`;
const APP = "/synthetic/acme/app";

interface Entry {
  path: string;
  repo: string;
  client: string;
  enabled?: boolean;
}

const ACME: Entry = { path: APP, repo: "acme/app", client: "acme" };
const GLOBEX: Entry = { path: "/synthetic/globex/portal", repo: "globex/portal", client: "globex" };

async function cacheRepo(fullName: string, trackerState: string | null = OK_STATE) {
  const [owner = "", name = ""] = fullName.split("/");
  const id = repoId("github.com", owner, name);
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: trackerState,
    trackerState,
    lastGoodFetchAt: NOW,
  });
  return id;
}

let counter = 0;

async function issue(
  id: string,
  issueState: string,
  over: { state?: string; labels?: string[]; children?: number[] } = {},
) {
  counter += 1;
  await database.db.insert(schema.workIssues).values({
    repoId: id,
    number: counter,
    title: "Synthetic",
    state: over.state ?? "open",
    issueState,
    priority: "medium",
    labels: over.labels ?? [],
    author: "synthetic-author",
    children: over.children ?? [],
    lastListedAt: NOW,
  });
}

async function issues(id: string, count: number, issueState: string, over = {}) {
  for (let index = 0; index < count; index += 1) await issue(id, issueState, over);
}

async function pull(id: string, base: string) {
  counter += 1;
  await database.db.insert(schema.workPullRequests).values({
    repoId: id,
    number: counter,
    title: "Synthetic",
    state: "open",
    draft: false,
    headBranch: "b",
    baseBranch: base,
    author: "synthetic-author",
    checks: "success",
    lastListedAt: NOW,
  });
}

async function dash(
  entries: Entry[],
  options: {
    client?: string;
    lines?: Record<string, unknown>[];
    events?: Record<string, unknown>[];
    lock?: boolean;
  } = {},
): Promise<DashResponse> {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify({ repos: entries }));
  if (options.lines !== undefined) await writeJsonl(factory, "runs", DAY, options.lines);
  if (options.events !== undefined) await writeJsonl(factory, "controls", DAY, options.events);
  if (options.lock === true) {
    await writeLock(factory, { run_id: "run-1", heartbeat: NOW.getTime() / 1000 - 240 });
  }
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

describe("GET /api/dash tiles", () => {
  it("counts the builds, the merged builds, the peak, the waits and the first-round pass", async () => {
    const id = await cacheRepo("acme/app");
    await issues(id, 2, "BLOCKED");
    await issue(id, "IN REVIEW", { labels: ["merge-ready"] });
    await issue(id, "TODO");
    await pull(id, "production");
    const start = (issueNumber: number, clock: string) =>
      nightLine({ issue: issueNumber, to: "IN PROGRESS", time: at(clock) });
    const end = (issueNumber: number, clock: string, from: string, to: string, reason: string) =>
      nightLine({ issue: issueNumber, from, to, reason, time: at(clock) });
    const lines = [
      start(1, "10:00"),
      start(2, "10:01"),
      start(3, "10:02"),
      start(4, "10:03"),
      end(1, "10:30", "IN REVIEW", "DONE", "merged #40"),
      end(2, "10:31", "IN REVIEW", "DONE", "merged #41"),
      end(3, "10:40", "IN PROGRESS", "BLOCKED", "gate failed"),
      end(4, "10:50", "IN PROGRESS", "IN REVIEW", "merge-ready #42"),
      start(5, "11:00"),
      start(6, "11:05"),
    ];
    const events = Array.from({ length: 10 }, (_, index) =>
      gateEvent({ pr: index + 1, decision: index < 7 ? "pass" : "fail", time: at("11:30") }),
    );
    const body = await dash([ACME], { lines, events });
    expect(body.tiles).toEqual({ builds: 6, peak: 4, merged: 2, waits: 5 });
    expect(body.reviewHealth.firstRound).toMatchObject({ rate: 70, total: 10 });
  });

  it("has no build numbers with no run", async () => {
    await cacheRepo("acme/app");
    const body = await dash([ACME]);
    expect(body.tiles).toEqual({ builds: null, peak: null, merged: null, waits: 0 });
  });
});

describe("GET /api/dash pipeline", () => {
  it("counts each stage, and puts the other issues in no stage", async () => {
    const id = await cacheRepo("acme/app");
    await issues(id, 2, "TODO");
    await issue(id, "TODO", { labels: ["spec-approved"] });
    await issue(id, "TODO", { labels: ["spec-approved", "issues-approved"] });
    await issue(id, "TODO", { labels: ["spec-approved", "finding"] });
    await issues(id, 3, "READY");
    await issues(id, 2, "IN PROGRESS");
    await issue(id, "IN REVIEW");
    await issue(id, "IN REVIEW", { labels: ["merge-ready"] });
    await issue(id, "BLOCKED");
    await issues(id, 4, "DONE", { state: "closed" });
    await issue(id, "DONE", { state: "closed", labels: ["merge-ready"] });
    await issues(id, 2, "", { state: "closed" });
    await pull(id, "production");
    await pull(id, "main");
    const body = await dash([ACME]);
    expect(body.pipeline).toEqual({
      spec: 2,
      issues: 1,
      ready: 3,
      inProgress: 2,
      inReview: 1,
      blocked: 1,
      done: 5,
      release: 2,
    });
    expect(body.complete).toEqual({ connectedRepos: 1, missingRepos: 0 });
  });

  it("uses the connected repos and counts the repo with no cache rows", async () => {
    const id = await cacheRepo("acme/app");
    await issues(id, 2, "READY");
    await cacheRepo("globex/portal", "not connected: no token");
    const body = await dash([ACME, GLOBEX]);
    expect(body.pipeline?.ready).toBe(2);
    expect(body.complete).toEqual({ connectedRepos: 1, missingRepos: 1 });
  });

  it("has no strip, no running builds and no waits when no repo in scope is connected", async () => {
    await cacheRepo("acme/app", "not connected: no token");
    const body = await dash([ACME]);
    expect(body.pipeline).toBeNull();
    expect(body.running).toBeNull();
    expect(body.tiles.waits).toBeNull();
    expect(body.complete).toEqual({ connectedRepos: 0, missingRepos: 1 });
  });

  it("counts a repo as connected with the fetch states that a real fetch writes", async () => {
    await cacheRepo("acme/app", "ok");
    await cacheRepo("globex/portal", "partial");
    const body = await dash([ACME, GLOBEX]);
    expect(body.complete).toEqual({ connectedRepos: 2, missingRepos: 0 });
  });
});

describe("GET /api/dash running builds", () => {
  async function seedRunning() {
    const acme = await cacheRepo("acme/app");
    const globex = await cacheRepo("globex/portal");
    const off = await cacheRepo("acme/off");
    await issues(acme, 2, "IN PROGRESS");
    await issues(globex, 2, "IN PROGRESS");
    await issue(off, "IN PROGRESS");
  }
  const OFF: Entry = {
    path: "/synthetic/acme/off",
    repo: "acme/off",
    client: "acme",
    enabled: false,
  };

  it("shows the slot limit only in the scope All, with a run in progress", async () => {
    await seedRunning();
    const all = await dash([ACME, GLOBEX, OFF], { lock: true, lines: [nightLine()] });
    expect(all.running).toEqual({ count: 4, slotLimit: 5 });
    const client = await dash([ACME, GLOBEX, OFF], {
      client: "acme",
      lock: true,
      lines: [nightLine()],
    });
    expect(client.running).toEqual({ count: 2, slotLimit: null });
  });

  it("has no slot limit between runs", async () => {
    const id = await cacheRepo("acme/app");
    await issues(id, 2, "IN PROGRESS");
    const body = await dash([ACME]);
    expect(body.run.state).toBe("none");
    expect(body.running).toEqual({ count: 2, slotLimit: null });
  });
});
