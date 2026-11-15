import { writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import {
  isoSeconds,
  makeFactoryDir,
  minutesAgo,
  nightLine,
  NOW,
  writeJsonl,
  writeLock,
} from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.db.delete(schema.workIssues);
});

afterAll(async () => {
  await database.db.delete(schema.workIssues);
  await database.close();
});

const DAY = "2026-11-15";
const at = (clock: string): string => isoSeconds(new Date(`${DAY}T${clock}:00Z`));
const APP = "/synthetic/acme/app";
const GLOBEX = "/synthetic/globex/portal";

const REPO_LIST = {
  repos: [
    { path: APP, repo: "acme/app", client: "acme" },
    { path: "/synthetic/acme/site", repo: "acme/site", client: "acme" },
    { path: GLOBEX, repo: "globex/portal", client: "globex" },
  ],
};

interface LastRun {
  runId: string;
  start: string;
  end: string;
  running: boolean;
  lanes: number;
  skips: number;
  blockedAtSelection: number;
  builds: { repo: string; repoId: string | null; issue: number; result: string; lane: number }[];
}

async function lastRun(
  lines: Record<string, unknown>[],
  options: { client?: string; lock?: unknown; parents?: number[] } = {},
): Promise<LastRun | null> {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify(REPO_LIST));
  await writeJsonl(factory, "runs", DAY, lines);
  if (options.lock !== undefined) await writeLock(factory, options.lock);
  for (const parent of options.parents ?? []) {
    await database.db.insert(schema.workIssues).values({
      repoId: repoId("github.com", "acme", "app"),
      number: parent,
      title: "A parent",
      state: "open",
      issueState: "IN PROGRESS",
      priority: "medium",
      author: "synthetic-author",
      children: [parent + 100],
      lastListedAt: NOW,
    });
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
  return response.json<{ lastRun: LastRun | null }>().lastRun;
}

const line = (over: Record<string, unknown>) => nightLine({ repo: APP, ...over });
const done = (issue: number, clock: string) =>
  line({ issue, from: "IN REVIEW", to: "DONE", reason: "merged #40", time: at(clock) });

describe("GET /api/dash lastRun", () => {
  it("is null with no night log", async () => {
    expect(await lastRun([])).toBeNull();
  });

  it("shows 3 open bars that end now for a run in progress", async () => {
    const run = await lastRun(
      [11, 12, 13].map((issue, index) =>
        line({ issue, time: isoSeconds(minutesAgo(90 - index * 10)) }),
      ),
      { lock: { run_id: "run-1", heartbeat: minutesAgo(4).getTime() / 1000 } },
    );
    expect(run?.running).toBe(true);
    expect(run?.end).toBe(NOW.toISOString());
    expect(run?.builds.map((build) => [build.result, build.lane])).toEqual([
      ["running", 1],
      ["running", 2],
      ["running", 3],
    ]);
  });

  it("lays out the slot timeline with a label for the result of each build", async () => {
    const run = await lastRun([
      line({ issue: 1, time: at("01:00") }),
      line({ issue: 2, time: at("01:10") }),
      line({ issue: 4, time: at("01:20") }),
      done(1, "03:00"),
      line({
        issue: 2,
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "merge-ready #41",
        time: at("04:00"),
      }),
      line({ issue: 3, time: at("03:30") }),
      line({ issue: 3, from: "IN PROGRESS", to: "BLOCKED", reason: "failed", time: at("05:00") }),
    ]);
    expect(
      run?.builds.map((b) => `${b.issue.toString()}:${b.lane.toString()}:${b.result}`),
    ).toEqual(["1:1:merged", "2:2:merge-ready", "4:3:stopped at run end", "3:1:blocked"]);
    expect(run?.builds[0]).toMatchObject({
      repo: "acme/app",
      repoId: repoId("github.com", "acme", "app"),
    });
  });

  it("counts 9 skips and blocked at selection, with no bar for them", async () => {
    const skips = Array.from({ length: 9 }, (_, n) =>
      line({
        issue: 30 + n,
        from: "READY",
        to: "READY",
        reason: "blocked by #3",
        time: at("02:00"),
      }),
    );
    const run = await lastRun([
      ...skips,
      line({ issue: 15, from: "READY", to: "BLOCKED", reason: "no token", time: at("02:10") }),
    ]);
    expect(run).toMatchObject({ skips: 9, blockedAtSelection: 1, builds: [] });
  });

  it("starts the build of a stopped run at the start of the window", async () => {
    const run = await lastRun([line({ issue: 9, time: at("01:00") }), done(12, "03:00")]);
    expect(run?.builds.find((b) => b.issue === 12)).toMatchObject({
      start: `${DAY}T01:00:00.000Z`,
      end: `${DAY}T03:00:00.000Z`,
      result: "merged",
    });
  });

  it("makes no build for an issue that has children in the Work cache", async () => {
    const run = await lastRun(
      [line({ issue: 5, time: at("01:00") }), line({ issue: 6, time: at("01:00") })],
      {
        parents: [5],
      },
    );
    expect(run?.builds.map((b) => b.issue)).toEqual([6]);
  });

  it("uses the older run of a client scope, with no gap for other clients", async () => {
    const run = await lastRun(
      [
        line({ run_id: "old", issue: 1, time: at("01:00") }),
        line({ run_id: "old", repo: GLOBEX, issue: 2, time: at("01:05") }),
        line({ run_id: "old", issue: 3, time: at("01:10") }),
        { ...done(1, "02:00"), run_id: "old" },
        line({ run_id: "new", repo: GLOBEX, issue: 4, time: at("05:00") }),
      ],
      { client: "acme" },
    );
    expect(run?.runId).toBe("old");
    expect(run?.builds.map((b) => b.lane)).toEqual([1, 2]);
    expect(run?.end).toBe(`${DAY}T02:00:00.000Z`);
  });

  it("ignores a repo folder outside the repo list in a client scope and labels it in All", async () => {
    const outside = line({ repo: "/elsewhere/tools/spike-cli", issue: 7, time: at("01:00") });
    expect(await lastRun([outside], { client: "acme" })).toBeNull();
    const run = await lastRun([outside]);
    expect(run?.builds).toMatchObject([{ repo: "spike-cli", repoId: null }]);
  });
});
