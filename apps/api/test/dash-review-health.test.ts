import { writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import type { ReviewHealth } from "@foreman/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { gateEvent, makeFactoryDir, NOW, writeJsonl } from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

async function clear(): Promise<void> {
  await database.db.delete(schema.workReviews);
  await database.db.delete(schema.workPullRequests);
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
const REPO_LIST = {
  repos: [
    { path: "/synthetic/acme/app", repo: "acme/app", client: "acme" },
    { path: "/synthetic/acme/site", repo: "acme/site", client: "acme" },
    { path: "/synthetic/globex/portal", repo: "globex/portal", client: "globex" },
  ],
};
const FACTORY = "synthetic-factory[bot]";

async function connect(owner: string, name: string): Promise<string> {
  const id = repoId("github.com", owner, name);
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: "connected",
    trackerState: "connected",
    lastGoodFetchAt: NOW,
  });
  return id;
}

async function pull(id: string, number: number, author: string, reviewers: string[]) {
  await database.db.insert(schema.workPullRequests).values({
    repoId: id,
    number,
    title: "Synthetic",
    state: "open",
    draft: false,
    headBranch: "b",
    baseBranch: "main",
    author,
    checks: "success",
    lastListedAt: NOW,
  });
  for (const [position, reviewer] of reviewers.entries()) {
    await database.db.insert(schema.workReviews).values({
      repoId: id,
      pullRequestNumber: number,
      position,
      author: reviewer,
      state: "COMMENTED",
      commit: "abc",
      time: NOW,
    });
  }
}

async function health(
  events: Record<string, unknown>[],
  options: { logins?: string; client?: string } = {},
): Promise<ReviewHealth> {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify(REPO_LIST));
  if (events.length > 0) await writeJsonl(factory, "controls", DAY, events);
  const app = await buildApp({
    config: {
      ...testConfig,
      FOREMAN_CLAUDE_DIR: claudeDir,
      FOREMAN_FACTORY_LOGINS: loadConfig({
        DATABASE_URL: testConfig.DATABASE_URL,
        FOREMAN_FACTORY_LOGINS: options.logins,
      }).FOREMAN_FACTORY_LOGINS,
    },
    db: database.db,
    logger: false,
    now: () => NOW,
  });
  const query = options.client === undefined ? "" : `?client=${options.client}`;
  const response = await app.inject({ method: "GET", url: `/api/dash${query}` });
  await app.close();
  expect(response.statusCode).toBe(200);
  return response.json<{ reviewHealth: ReviewHealth }>().reviewHealth;
}

const event = (over: Record<string, unknown>) => gateEvent(over);

describe("GET /api/dash reviewHealth", () => {
  it("shows the rates by tier, the rounds, the escalations and the Waivers in use", async () => {
    const escalated = (pr: number, repo: string) => ({
      kind: "escalated",
      repo,
      time: "2026-11-15T11:00:00Z",
      pr,
      issue: null,
      path_tier: "general",
      tier: "sensitive",
      paths: [],
      evidence: [],
    });
    const waiver = (pr: number, repo: string) => ({
      kind: "waiver_used",
      repo,
      time: "2026-11-15T11:00:00Z",
      pr,
      waiver: "W-1",
      finding: "f",
    });
    const result = await health([
      ...[1, 2, 3, 4, 5, 6].map((pr) =>
        event({
          pr,
          tier: pr <= 3 ? "general" : "sensitive",
          decision: pr % 3 === 0 ? "fail" : "pass",
        }),
      ),
      event({ pr: 3, round: 2 }),
      event({ pr: 7, repo: "acme/site", tier: null, decision: "fail", matrix: { a: 1 } }),
      event({ pr: 7, repo: "acme/site", round: 2, decision: "fail" }),
      event({ pr: 7, repo: "acme/site", round: 3, decision: "pass" }),
      event({ pr: 8, repo: "acme/site", tier: null, decision: "pass" }),
      event({ pr: 9, repo: "acme/site", tier: "general", decision: "pass" }),
      event({ pr: 10, repo: "acme/site", tier: "general", decision: "pass" }),
      escalated(1, "acme/app"),
      escalated(2, "acme/app"),
      escalated(1, "acme/site"),
      waiver(1, "acme/app"),
      waiver(2, "acme/app"),
      waiver(1, "acme/site"),
    ]);
    expect(result.firstRound.total).toBe(10);
    expect(result.firstRound.passed).toBe(7);
    expect(result.firstRound.rate).toBe(70);
    expect(result.firstRound.tiers).toEqual([
      { tier: "general", passed: 4, total: 5, rate: 80 },
      { tier: "sensitive", passed: 2, total: 3, rate: 67 },
      { tier: null, passed: 1, total: 2, rate: 50 },
    ]);
    expect(result.rounds).toEqual({ one: 8, two: 1, three: 1 });
    expect(result.escalations).toBe(3);
    expect(result.waiversInUse).toBe(2);
  });

  it("has no rate with no gate decision in 30 days", async () => {
    const result = await health([event({ decision: "wait" })]);
    expect(result.firstRound).toEqual({ rate: null, passed: 0, total: 0, tiers: [] });
  });

  it("uses only the events of the repos of the Client scope", async () => {
    const result = await health(
      [event({ pr: 1 }), event({ pr: 2, repo: "globex/portal", decision: "fail" })],
      { client: "globex" },
    );
    expect(result.firstRound).toMatchObject({ passed: 0, total: 1, rate: 0 });
  });

  it("counts the factory pull requests of a repo with no Control events", async () => {
    const app = await connect("acme", "app");
    await pull(app, 1, FACTORY, [FACTORY]);
    await pull(app, 2, FACTORY, ["synthetic-other", FACTORY]);
    await pull(app, 3, FACTORY, [FACTORY]);
    await pull(app, 4, FACTORY, ["synthetic-other"]);
    await pull(app, 5, "synthetic-operator", [FACTORY]);
    const result = await health([event({ repo: "acme/site" })], { logins: FACTORY });
    expect(result.factoryLoginSet).toBe(true);
    expect(result.reposWithoutControls).toEqual([
      { repoId: app, repo: "acme/app", reviewed: 3, unreviewed: 1 },
    ]);
  });

  it("shows no repo with Control events and no repo that is not connected", async () => {
    await connect("acme", "app");
    const result = await health([event({ repo: "acme/app" })], { logins: FACTORY });
    expect(result.reposWithoutControls).toEqual([]);
    await clear();
    expect((await health([], { logins: FACTORY })).reposWithoutControls).toEqual([]);
  });

  it("shows no review counts with no Factory identity login", async () => {
    const app = await connect("acme", "app");
    await pull(app, 1, FACTORY, [FACTORY]);
    for (const logins of [undefined, "", "   "]) {
      const result = await health([], logins === undefined ? {} : { logins });
      expect(result.factoryLoginSet).toBe(false);
      expect(result.reposWithoutControls).toEqual([
        { repoId: app, repo: "acme/app", reviewed: null, unreviewed: null },
      ]);
    }
  });
});
