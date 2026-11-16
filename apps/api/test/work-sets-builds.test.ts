import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import {
  WorkItemsResponse as WorkItemsResponseSchema,
  type WorkItemsResponse,
} from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { isoSeconds, makeFactoryDir, nightLine, NOW, writeJsonl } from "./dash-fixtures.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry } from "./repo-list-fixtures.ts";
import { writeTokens } from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_commit_statuses`,
  );
});

const APP = repoId("github.com", "acme", "app");
const WEB = repoId("github.com", "acme", "web");
const DAY = "2026-11-15";
const at = (clock: string): string => isoSeconds(new Date(`${DAY}T${clock}:00Z`));
const APP_DIR = "/synthetic/acme/app";
const WEB_DIR = "/synthetic/acme/web";
const PORTAL_DIR = "/synthetic/globex/portal";
const STRAY_DIR = "/synthetic/elsewhere/stray";

const REPOS = [
  entry("acme/app", "acme"),
  entry("acme/web", "acme"),
  entry("globex/portal", "globex"),
];

/** The lines of one build: the start line and the end line. */
function build(
  issue: number,
  folder: string,
  start: string,
  end: string,
  endTo = "DONE",
  run = "r1",
): Record<string, unknown>[] {
  return [
    nightLine({
      run_id: run,
      repo: folder,
      issue,
      from: "READY",
      to: "IN PROGRESS",
      time: at(start),
    }),
    nightLine({
      run_id: run,
      repo: folder,
      issue,
      from: "IN PROGRESS",
      to: endTo,
      reason: endTo === "DONE" ? "merged" : "stopped",
      time: at(end),
    }),
  ];
}

async function cacheIssue(id: string, number: number, title: string): Promise<void> {
  await database.db.insert(schema.workIssues).values({
    repoId: id,
    number,
    title,
    link: `https://example.test/${number.toString()}`,
    state: "open",
    issueState: "IN PROGRESS",
    priority: "medium",
    author: "synthetic-author",
    children: [],
    lastListedAt: NOW,
  });
}

async function connect(id: string, fullName: string): Promise<void> {
  const [owner = "", name = ""] = fullName.split("/");
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: OK_STATE,
    trackerState: OK_STATE,
    lastGoodFetchAt: NOW,
  });
}

async function setup(lines: Record<string, unknown>[]) {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify({ repos: REPOS }));
  await writeJsonl(factory, "runs", DAY, lines);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": "t" });
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile },
    db: database.db,
    logger: false,
    now: () => NOW,
  });
  return { app, factory };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

async function rows(app: App, query: string): Promise<WorkItemsResponse> {
  const response = await app.inject({ method: "GET", url: `/api/work/items?${query}` });
  expect(response.statusCode).toBe(200);
  return WorkItemsResponseSchema.parse(response.json<unknown>());
}

/** `owner/name#issue` of each row, the issue from the build context. */
const who = (page: WorkItemsResponse): string[] =>
  page.items.map(
    (row) =>
      `${row.fullName}#${row.context?.kind === "build" ? row.context.issue.toString() : "?"}`,
  );

describe("GET /api/work/items set=builds", () => {
  it("lists the builds of the run by start, then repo, then number, with the build context", async () => {
    await connect(APP, "acme/app");
    await connect(WEB, "acme/web");
    await cacheIssue(APP, 12, "Add the export");
    const { app } = await setup([
      ...build(30, APP_DIR, "02:00", "02:30"),
      ...build(12, APP_DIR, "01:00", "03:00"),
      ...build(7, WEB_DIR, "01:00", "01:40", "BLOCKED"),
      ...build(5, WEB_DIR, "01:00", "01:20"),
      ...build(99, APP_DIR, "00:10", "00:20", "DONE", "older-run"),
    ]);
    const page = await rows(app, "set=builds&run=r1");
    expect(who(page)).toEqual(["acme/app#12", "acme/web#5", "acme/web#7", "acme/app#30"]);
    expect(page.items[0]?.issue?.title).toBe("Add the export");
    expect(page.items[0]?.context).toEqual({
      kind: "build",
      issue: 12,
      start: `${DAY}T01:00:00.000Z`,
      end: `${DAY}T03:00:00.000Z`,
      result: "merged",
    });
    expect(page.items[2]?.context).toMatchObject({ kind: "build", result: "blocked" });
    expect(page.counts.all).toBe(4);
    expect(page.sources).toEqual({ runs: "ok", controls: "missing" });
  });

  it("gives a bare row with the folder label to a build with no Work cache row", async () => {
    const { app } = await setup(build(8, STRAY_DIR, "01:00", "02:00"));
    const page = await rows(app, "set=builds&run=r1");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      repoId: null,
      fullName: "stray",
      issue: null,
      pullRequest: null,
      context: { kind: "build", issue: 8, result: "merged" },
    });
  });

  it("shows the builds from the night log when no repo is connected", async () => {
    const { app } = await setup(build(12, APP_DIR, "01:00", "03:00"));
    const page = await rows(app, "set=builds&run=r1");
    expect(page.state).toBe("not_connected");
    expect(page.items.map((row) => row.fullName)).toEqual(["acme/app"]);
    expect(page.items[0]?.issue).toBeNull();
  });

  it("has no rows for a run with no line in the window", async () => {
    const { app } = await setup(build(12, APP_DIR, "01:00", "03:00"));
    const page = await rows(app, "set=builds&run=unknown");
    expect(page.items).toEqual([]);
    expect(page.counts.all).toBe(0);
  });

  it("matches the Gantt of the dash in a client scope", async () => {
    await connect(APP, "acme/app");
    const { app } = await setup([
      ...build(12, APP_DIR, "01:00", "03:00"),
      ...build(4, PORTAL_DIR, "01:10", "02:00"),
    ]);
    const dash = (await app.inject({ method: "GET", url: "/api/dash?client=acme" })).json<{
      lastRun: { builds: unknown[] };
    }>();
    const page = await rows(app, "set=builds&run=r1&client=acme");
    expect(page.items).toHaveLength(dash.lastRun.builds.length);
    expect(page.items.map((row) => row.fullName)).toEqual(["acme/app"]);
    expect((await rows(app, "set=builds&run=r1")).items).toHaveLength(2);
  });

  it("reports an unreadable runs folder", async () => {
    const { app, factory } = await setup(build(12, APP_DIR, "01:00", "03:00"));
    await chmod(path.join(factory, "runs"), 0o000);
    try {
      const page = await rows(app, "set=builds&run=r1");
      expect(page.sources?.runs).toBe("unreadable");
      expect(page.items).toEqual([]);
    } finally {
      await chmod(path.join(factory, "runs"), 0o755);
    }
  });

  it("pages the builds", async () => {
    const { app } = await setup([
      ...build(1, APP_DIR, "01:00", "02:00"),
      ...build(2, APP_DIR, "01:10", "02:00"),
      ...build(3, APP_DIR, "01:20", "02:00"),
    ]);
    const first = await rows(app, "set=builds&run=r1&limit=2");
    expect(first.items).toHaveLength(2);
    const second = await rows(app, `set=builds&run=r1&limit=2&cursor=${first.nextCursor ?? ""}`);
    expect(who(second)).toEqual(["acme/app#3"]);
  });
});

describe("GET /api/work/items set=merged", () => {
  it("lists only the merged builds, by end, then repo, then number", async () => {
    const { app } = await setup([
      ...build(1, APP_DIR, "01:00", "03:00"),
      ...build(2, APP_DIR, "01:10", "04:00", "BLOCKED"),
      ...build(3, WEB_DIR, "02:00", "02:30"),
      ...build(4, WEB_DIR, "01:50", "03:00"),
    ]);
    const page = await rows(app, "set=merged&run=r1");
    expect(who(page)).toEqual(["acme/web#3", "acme/app#1", "acme/web#4"]);
    expect(page.counts.all).toBe(3);
  });
});
