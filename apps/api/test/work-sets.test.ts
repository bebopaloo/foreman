import { schema } from "@foreman/db";
import type { DashResponse, WorkItemsResponse } from "@foreman/shared";
import {
  WorkItemsResponse as WorkItemsResponseSchema,
  SET_LABELS,
  WORK_SETS,
} from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { NOW } from "./dash-fixtures.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
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
const PORTAL = repoId("github.com", "globex", "portal");

async function appFor(repos: unknown[] | null = null) {
  const claudeDir = await makeClaudeDir({
    repos: repos ?? [
      entry("acme/app", "acme"),
      entry("acme/web", "acme"),
      entry("globex/portal", "globex"),
    ],
  });
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": "t" });
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false, now: () => NOW });
}

type App = Awaited<ReturnType<typeof appFor>>;

async function connect(id: string, fullName: string, trackerState: string | null = OK_STATE) {
  const [owner = "", name = ""] = fullName.split("/");
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: trackerState,
    trackerState,
    lastGoodFetchAt: NOW,
  });
}

let counter = 0;

async function issue(
  id: string,
  issueState: string,
  over: {
    number?: number;
    state?: string;
    priority?: string;
    labels?: string[];
    title?: string;
  } = {},
): Promise<number> {
  counter += 1;
  const number = over.number ?? counter;
  await database.db.insert(schema.workIssues).values({
    repoId: id,
    number,
    title: over.title ?? `Issue ${number.toString()}`,
    state: over.state ?? "open",
    issueState,
    priority: over.priority ?? "medium",
    labels: over.labels ?? [],
    author: "synthetic-author",
    children: [],
    lastListedAt: NOW,
  });
  return number;
}

async function pull(id: string, base: string, number?: number): Promise<number> {
  counter += 1;
  const used = number ?? counter;
  await database.db.insert(schema.workPullRequests).values({
    repoId: id,
    number: used,
    title: `Pull ${used.toString()}`,
    state: "open",
    draft: false,
    headBranch: "b",
    baseBranch: base,
    author: "synthetic-author",
    checks: "success",
    lastListedAt: NOW,
  });
  return used;
}

async function get(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function rows(app: App, query: string): Promise<WorkItemsResponse> {
  const { status, body } = await get(app, `/api/work/items?${query}`);
  expect(status).toBe(200);
  return WorkItemsResponseSchema.parse(body);
}

async function dash(app: App, query = ""): Promise<DashResponse> {
  const response = await app.inject({ method: "GET", url: `/api/dash${query}` });
  return response.json<DashResponse>();
}

const numbers = (page: WorkItemsResponse) =>
  page.items.map((row) => [row.fullName, row.issue?.number ?? row.pullRequest?.number ?? null]);

describe("SET_LABELS", () => {
  it("names a heading for each set", () => {
    expect(Object.keys(SET_LABELS).sort()).toEqual([...WORK_SETS].sort());
    expect(SET_LABELS.builds).toBe("Builds in the last run");
  });
});

describe("GET /api/work/items set: a pipeline stage", () => {
  async function seed() {
    await connect(APP, "acme/app");
    await connect(WEB, "acme/web");
    await issue(APP, "TODO", { number: 1, priority: "low" });
    await issue(APP, "TODO", { number: 2, priority: "high" });
    await issue(WEB, "TODO", { number: 3, priority: "high" });
    await issue(APP, "TODO", { number: 4, labels: ["spec-approved"] });
    await issue(APP, "READY", { number: 5 });
    await issue(APP, "IN PROGRESS", { number: 6 });
    await issue(APP, "IN REVIEW", { number: 7 });
    await issue(APP, "IN REVIEW", { number: 8, labels: ["merge-ready"], priority: "high" });
    await issue(APP, "BLOCKED", { number: 9 });
    await issue(WEB, "DONE", { number: 10, state: "closed" });
    await issue(APP, "DONE", { number: 11, state: "closed" });
    await issue(APP, "DONE", { number: 12, state: "closed" });
    await pull(APP, "production", 40);
    await pull(WEB, "production", 41);
    await pull(APP, "main", 42);
  }

  it("has as many rows as the dash count of its stage", async () => {
    await seed();
    const app = await appFor();
    const { pipeline } = await dash(app);
    const stages = {
      stage_g1: pipeline?.spec,
      stage_g2: pipeline?.issues,
      stage_ready: pipeline?.ready,
      stage_in_progress: pipeline?.inProgress,
      stage_in_review: pipeline?.inReview,
      stage_blocked: pipeline?.blocked,
      stage_done: pipeline?.done,
      stage_g3: pipeline?.release,
    };
    for (const [set, count] of Object.entries(stages)) {
      const page = await rows(app, `set=${set}`);
      expect(page.counts.all, set).toBe(count);
      expect(page.items.length, set).toBe(count);
      expect(page.state).toBe("ok");
      expect(page.sources).toEqual({ runs: "missing", controls: "missing" });
      expect(page.events).toBeNull();
    }
  });

  it("orders G1 by priority, then owner/name, then number from high to low", async () => {
    await seed();
    const app = await appFor();
    expect(numbers(await rows(app, "set=stage_g1"))).toEqual([
      ["acme/app", 2],
      ["acme/web", 3],
      ["acme/app", 1],
    ]);
  });

  it("puts the pull requests into production before the merge-ready issue in G3", async () => {
    await seed();
    const app = await appFor();
    const page = await rows(app, "set=stage_g3");
    expect(
      page.items.map((row) => [row.fullName, row.pullRequest?.number, row.issue?.number]),
    ).toEqual([
      ["acme/web", 41, undefined],
      ["acme/app", 40, undefined],
      ["acme/app", undefined, 8],
    ]);
  });

  it("orders DONE by owner/name, then number from high to low", async () => {
    await seed();
    const app = await appFor();
    expect(numbers(await rows(app, "set=stage_done"))).toEqual([
      ["acme/app", 12],
      ["acme/app", 11],
      ["acme/web", 10],
    ]);
  });

  it("counts the rows by Issue state, with a pull request that has no issue as none", async () => {
    await seed();
    const app = await appFor();
    const page = await rows(app, "set=stage_g3");
    expect(page.counts).toMatchObject({ all: 3, "IN REVIEW": 1, none: 2 });
  });

  it("has no context, and a null repoId only for a row outside the repo list", async () => {
    await seed();
    const app = await appFor();
    const page = await rows(app, "set=stage_blocked");
    expect(page.items.map((row) => [row.context, row.repoId])).toEqual([[null, APP]]);
  });

  it("shows the issues of the client scope only", async () => {
    await connect(APP, "acme/app");
    await connect(PORTAL, "globex/portal");
    await issue(APP, "BLOCKED");
    await issue(APP, "BLOCKED");
    await issue(PORTAL, "BLOCKED");
    const app = await appFor();
    expect((await rows(app, "set=stage_blocked&client=acme")).counts.all).toBe(2);
    expect((await rows(app, "set=stage_blocked")).counts.all).toBe(3);
  });

  it("pages by the list conventions, with the set in the cursor", async () => {
    await connect(APP, "acme/app");
    for (let index = 0; index < 230; index += 1) await issue(APP, "DONE", { state: "closed" });
    const app = await appFor();
    const first = await rows(app, "set=stage_done");
    expect(first.items).toHaveLength(100);
    const second = await rows(app, `set=stage_done&cursor=${first.nextCursor ?? ""}`);
    const third = await rows(app, `set=stage_done&cursor=${second.nextCursor ?? ""}`);
    expect(third.items).toHaveLength(30);
    expect(third.nextCursor).toBeNull();
    expect(first.counts.all).toBe(230);
    const seen = new Set(
      [...first.items, ...second.items, ...third.items].map((row) => row.issue?.number),
    );
    expect(seen.size).toBe(230);
    const other = await get(
      app,
      `/api/work/items?set=stage_ready&cursor=${first.nextCursor ?? ""}`,
    );
    expect(other.status).toBe(400);
  });
});

describe("GET /api/work/items set=waits", () => {
  it("lists all the items in the order of the dash, each with its reason and source", async () => {
    await connect(APP, "acme/app");
    for (let index = 0; index < 22; index += 1) await issue(APP, "BLOCKED");
    await issue(APP, "IN REVIEW", { labels: ["merge-ready"] });
    await issue(APP, "TODO");
    await pull(APP, "production");
    for (let index = 0; index < 5; index += 1)
      await issue(APP, "TODO", { labels: ["spec-approved"] });
    const app = await appFor();
    const body = await dash(app);
    expect(body.waits?.total).toBe(30);
    const page = await rows(app, "set=waits&limit=500");
    expect(page.counts.all).toBe(30);
    expect(page.items).toHaveLength(30);
    expect(
      page.items.slice(0, 20).map((row) => row.issue?.number ?? row.pullRequest?.number),
    ).toEqual(body.waits?.items.map((item) => item.number));
    const kinds = page.items.map((row) => (row.context?.kind === "wait" ? row.context.wait : null));
    expect(kinds.slice(0, 22).every((kind) => kind === "blocked")).toBe(true);
    expect(kinds.slice(22)).toEqual([
      "release",
      "merge_ready",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    const first = page.items[0];
    expect(first?.context).toEqual({
      kind: "wait",
      wait: "blocked",
      reason: "see the comment in the tracker",
      source: "tracker",
    });
    const release = page.items[22];
    expect(release?.pullRequest?.number).toBeDefined();
    expect(release?.context).toMatchObject({ wait: "release", source: "forge" });
  });
});

describe("GET /api/work/items set: not connected", () => {
  it("returns no rows for a stage or waits when no repo is connected", async () => {
    await connect(APP, "acme/app", "not fetched");
    await issue(APP, "BLOCKED");
    const app = await appFor();
    for (const set of ["waits", "stage_blocked", "stage_g3"]) {
      const page = await rows(app, `set=${set}`);
      expect(page.state, set).toBe("not_connected");
      expect(page.items, set).toEqual([]);
      expect(page.counts.all, set).toBe(0);
    }
  });
});

describe("GET /api/work/items set: the sets of later issues", () => {
  it("returns no rows yet for builds, merged and the review sets, with their sources", async () => {
    await connect(APP, "acme/app");
    await issue(APP, "BLOCKED");
    const app = await appFor();
    for (const query of [
      "set=builds&run=r1",
      "set=merged&run=r1",
      "set=tier_general",
      "set=round_2",
      "set=escalated",
      "set=waivers",
    ]) {
      const page = await rows(app, query);
      expect(page.items, query).toEqual([]);
      expect(page.sources, query).toEqual({ runs: "missing", controls: "missing" });
    }
    expect((await rows(app, "set=escalated")).events).toBe(0);
    expect((await rows(app, "set=waivers")).events).toBe(0);
    expect((await rows(app, "set=round_1")).events).toBeNull();
  });
});

describe("GET /api/work/items query values that are not valid", () => {
  it("rejects each wrong combination of set and run with 400", async () => {
    const app = await appFor();
    const long = "r".repeat(201);
    for (const query of [
      "set=builds",
      "set=merged",
      "run=r1",
      "set=waits&run=r1",
      "set=stage_blocked&run=r1",
      "set=stage_done&issue_state=DONE",
      "set=stage_done&type=feature",
      "set=stage_done&priority=high",
      `set=stage_done&repo=${APP}`,
      "set=stage_done&sort=repo",
      "set=stage_doing",
      `set=builds&run=${long}`,
      "set=builds&run=",
    ]) {
      expect((await get(app, `/api/work/items?${query}`)).status, query).toBe(400);
    }
    expect((await get(app, `/api/work/items?set=builds&run=${"r".repeat(200)}`)).status).toBe(200);
  });
});

describe("GET /api/work/items with no set", () => {
  it("has a null context, sources and events", async () => {
    await connect(APP, "acme/app");
    await issue(APP, "READY");
    const app = await appFor();
    const page = await rows(app, "");
    expect(page.items[0]?.context).toBeNull();
    expect(page.sources).toBeNull();
    expect(page.events).toBeNull();
  });
});
