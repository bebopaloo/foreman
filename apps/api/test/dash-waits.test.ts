import { writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import type { DashResponse } from "@foreman/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { makeFactoryDir, nightLine, NOW, writeJsonl } from "./dash-fixtures.ts";

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
const ENTRIES = [
  { path: "/synthetic/acme/app", repo: "acme/app", client: "acme" },
  { path: "/synthetic/globex/portal", repo: "globex/portal", client: "globex" },
];

async function cacheRepo(fullName: string, state = OK_STATE): Promise<string> {
  const [owner = "", name = ""] = fullName.split("/");
  const id = repoId("github.com", owner, name);
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: state,
    trackerState: state,
    lastGoodFetchAt: NOW,
  });
  return id;
}

interface IssueOptions {
  number: number;
  title?: string;
  priority?: string;
  labels?: string[];
  state?: string;
  link?: string | null;
}

async function issue(id: string, issueState: string, options: IssueOptions) {
  await database.db.insert(schema.workIssues).values({
    repoId: id,
    number: options.number,
    title: options.title ?? `Synthetic ${options.number.toString()}`,
    state: options.state ?? "open",
    issueState,
    priority: options.priority ?? "medium",
    labels: options.labels ?? [],
    author: "synthetic-author",
    link:
      options.link === undefined
        ? `https://github.com/synthetic/issues/${options.number.toString()}`
        : options.link,
    lastListedAt: NOW,
  });
}

async function pull(id: string, number: number, base: string) {
  await database.db.insert(schema.workPullRequests).values({
    repoId: id,
    number,
    title: "Release 1.2",
    state: "open",
    draft: false,
    headBranch: "release/1.2",
    baseBranch: base,
    author: "synthetic-author",
    checks: "success",
    link: `https://github.com/synthetic/pull/${number.toString()}`,
    lastListedAt: NOW,
  });
}

async function dash(lines: Record<string, unknown>[] = [], client?: string): Promise<DashResponse> {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify({ repos: ENTRIES }));
  if (lines.length > 0) await writeJsonl(factory, "runs", DAY, lines);
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
    db: database.db,
    logger: false,
    now: () => NOW,
  });
  const query = client === undefined ? "" : `?client=${client}`;
  const response = await app.inject({ method: "GET", url: `/api/dash${query}` });
  await app.close();
  expect(response.statusCode).toBe(200);
  return response.json<DashResponse>();
}

describe("GET /api/dash waits", () => {
  it("lists the items in the order of factory-next, each with its repo, number, title, reason, source and link", async () => {
    const id = await cacheRepo("acme/app");
    await issue(id, "BLOCKED", { number: 2, priority: "low", title: "Blocked low" });
    await issue(id, "BLOCKED", { number: 1, priority: "high", title: "Blocked high" });
    await issue(id, "IN REVIEW", { number: 3, labels: ["merge-ready"], title: "Ready" });
    await issue(id, "TODO", { number: 4, title: "Needs a spec" });
    await issue(id, "TODO", { number: 5, labels: ["spec-waived"], title: "Waived" });
    await pull(id, 9, "production");
    const lines = [
      nightLine({ issue: 1, from: "IN PROGRESS", to: "BLOCKED", reason: "an older reason" }),
      nightLine({
        issue: 1,
        from: "IN PROGRESS",
        to: "BLOCKED",
        reason: "auto mode refused the migration",
        time: "2026-11-15T11:50:00Z",
      }),
    ];
    const { waits, tiles } = await dash(lines);
    expect(waits?.items.map((item) => [item.kind, item.number, item.reason, item.source])).toEqual([
      ["blocked", 1, "auto mode refused the migration", "night log"],
      ["blocked", 2, "see the comment in the tracker", "tracker"],
      ["release", 9, "Release to perform", "forge"],
      ["merge_ready", 3, "merge-ready, waits for G3", "tracker"],
      ["todo", 4, "Spec and G1", "tracker"],
      ["todo", 5, "make it READY", "tracker"],
    ]);
    expect(waits?.items[0]).toEqual({
      kind: "blocked",
      repoId: id,
      repo: "acme/app",
      number: 1,
      title: "Blocked high",
      reason: "auto mode refused the migration",
      source: "night log",
      link: "https://github.com/synthetic/issues/1",
    });
    expect(waits?.total).toBe(6);
    expect(tiles.waits).toBe(6);
  });

  it("shows the first 20 of 30 items and counts 30 in the tile", async () => {
    const id = await cacheRepo("acme/app");
    for (let number = 1; number <= 30; number += 1) await issue(id, "BLOCKED", { number });
    const { waits, tiles } = await dash();
    expect(waits?.items).toHaveLength(20);
    expect(waits?.items.map((item) => item.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(waits?.total).toBe(30);
    expect(tiles.waits).toBe(30);
  });

  it("has no item when nothing waits", async () => {
    const id = await cacheRepo("acme/app");
    await issue(id, "READY", { number: 1 });
    expect((await dash()).waits).toEqual({ total: 0, items: [] });
  });

  it("sends a title with HTML and Markdown as it is", async () => {
    const id = await cacheRepo("acme/app");
    const title = "<img src=x onerror=alert(1)> **bold** [link](https://evil.test)";
    await issue(id, "BLOCKED", { number: 1, title });
    expect((await dash()).waits?.items[0]?.title).toBe(title);
  });

  it("uses only the items of the repos in the Client scope", async () => {
    const acme = await cacheRepo("acme/app");
    const globex = await cacheRepo("globex/portal");
    await issue(acme, "BLOCKED", { number: 1 });
    await issue(globex, "BLOCKED", { number: 2 });
    const scoped = await dash([], "acme");
    expect(scoped.waits?.items.map((item) => item.repo)).toEqual(["acme/app"]);
    expect(scoped.tiles.waits).toBe(1);
    expect((await dash()).waits?.total).toBe(2);
  });

  it("has no waits when no repo in scope is connected", async () => {
    const id = await cacheRepo("acme/app", "not connected: no token");
    await issue(id, "BLOCKED", { number: 1 });
    expect((await dash()).waits).toBeNull();
  });
});
