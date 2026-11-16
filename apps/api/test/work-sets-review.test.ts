import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import { WorkItemsResponse as WorkItemsResponseSchema, type DashResponse } from "@foreman/shared";
import type { WorkItemsResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { gateEvent, makeFactoryDir, NOW, writeJsonl } from "./dash-fixtures.ts";
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
const DAY = "2026-11-15";
const REPOS = [
  entry("acme/app", "acme"),
  entry("acme/web", "acme"),
  entry("globex/portal", "globex"),
];

const gate = (over: Record<string, unknown>) => gateEvent(over);
const escalated = (pr: number, pathTier: string | null, tier: string | null, minute: number) => ({
  kind: "escalated",
  repo: "acme/app",
  time: `2026-11-15T11:${String(minute).padStart(2, "0")}:00Z`,
  pr,
  issue: null,
  path_tier: pathTier,
  tier,
  paths: [],
  evidence: [],
});
const waiver = (pr: number, id: string, repo = "acme/app") => ({
  kind: "waiver_used",
  repo,
  time: "2026-11-15T11:00:00Z",
  pr,
  waiver: id,
  finding: "f",
});

async function appWith(events: Record<string, unknown>[], repos: unknown[] = REPOS) {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify({ repos }));
  if (events.length > 0) await writeJsonl(factory, "controls", DAY, events);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": "t" });
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  const app = await buildApp({ config, db: database.db, logger: false, now: () => NOW });
  return { app, factory };
}

async function connect(id: string, fullName: string) {
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

async function cachedIssue(id: string, number: number) {
  await database.db.insert(schema.workIssues).values({
    repoId: id,
    number,
    title: `Issue ${number.toString()}`,
    state: "open",
    issueState: "IN REVIEW",
    priority: "medium",
    labels: [],
    author: "synthetic-author",
    children: [],
    lastListedAt: NOW,
  });
}

async function cachedPull(
  id: string,
  number: number,
  over: { linkedIssue?: number; state?: string; link?: string } = {},
) {
  await database.db.insert(schema.workPullRequests).values({
    repoId: id,
    number,
    title: `Pull ${number.toString()}`,
    state: over.state ?? "open",
    draft: false,
    headBranch: "b",
    baseBranch: "main",
    author: "synthetic-author",
    checks: "success",
    linkedIssue: over.linkedIssue ?? null,
    link: over.link ?? null,
    lastListedAt: NOW,
  });
}

type App = Awaited<ReturnType<typeof appWith>>["app"];

async function rows(app: App, query: string): Promise<WorkItemsResponse> {
  const response = await app.inject({ method: "GET", url: `/api/work/items?${query}` });
  expect(response.statusCode).toBe(200);
  return WorkItemsResponseSchema.parse(response.json<unknown>());
}

async function dashOf(app: App): Promise<DashResponse> {
  const response = await app.inject({ method: "GET", url: "/api/dash" });
  return response.json<DashResponse>();
}

const numbers = (page: WorkItemsResponse) =>
  page.items.map((row) => [
    row.fullName,
    row.context?.kind === "review" ? row.context.pullRequest : null,
  ]);

const detailOf = (page: WorkItemsResponse) =>
  page.items.map((row) => (row.context?.kind === "review" ? row.context.detail : null));

describe("GET /api/work/items set: the Risk tier sets", () => {
  const events = [
    gate({ pr: 1, tier: "general", decision: "fail" }),
    gate({ pr: 1, tier: "general", round: 2, decision: "pass" }),
    gate({ pr: 2, tier: "general", decision: "pass" }),
    gate({ pr: 3, tier: "general", decision: "pass" }),
    gate({ pr: 4, tier: "sensitive", decision: "pass" }),
    gate({ pr: 5, tier: null, decision: "pass" }),
    gate({ pr: 6, tier: "general", decision: "wait" }),
    gate({ pr: 7, tier: "inert", repo: "acme/web", decision: "fail" }),
  ];

  it("lists the pull requests of a tier with their first decision, numbers high to low", async () => {
    const { app } = await appWith(events);
    const page = await rows(app, "set=tier_general");
    expect(numbers(page)).toEqual([
      ["acme/app", 3],
      ["acme/app", 2],
      ["acme/app", 1],
    ]);
    expect(detailOf(page)).toEqual([
      { type: "decision", decision: "pass" },
      { type: "decision", decision: "pass" },
      { type: "decision", decision: "fail" },
    ]);
    expect(page.events).toBeNull();
    expect(page.items.every((row) => row.context?.kind === "review")).toBe(true);
  });

  it("has as many rows as the dash number of its tier", async () => {
    const { app } = await appWith(events);
    const dash = await dashOf(app);
    const rates = new Map(
      dash.reviewHealth.firstRound.tiers.map((tier) => [tier.tier, tier.total]),
    );
    for (const [set, tier] of [
      ["tier_general", "general"],
      ["tier_sensitive", "sensitive"],
      ["tier_inert", "inert"],
      ["tier_none", null],
    ] as const) {
      expect((await rows(app, `set=${set}`)).items, set).toHaveLength(rates.get(tier) ?? 0);
    }
    expect((await rows(app, "set=tier_authority")).items).toHaveLength(0);
  });

  it("orders by owner/name, then number from high to low", async () => {
    const { app } = await appWith([
      gate({ pr: 9, repo: "acme/web", tier: "general" }),
      gate({ pr: 2, repo: "acme/app", tier: "general" }),
      gate({ pr: 5, repo: "acme/app", tier: "general" }),
    ]);
    expect(numbers(await rows(app, "set=tier_general"))).toEqual([
      ["acme/app", 5],
      ["acme/app", 2],
      ["acme/web", 9],
    ]);
  });

  it("counts number 7 of two repos as two pull requests", async () => {
    const { app } = await appWith([
      gate({ pr: 7, repo: "acme/app", tier: "general" }),
      gate({ pr: 7, repo: "acme/web", tier: "general" }),
    ]);
    expect(numbers(await rows(app, "set=tier_general"))).toEqual([
      ["acme/app", 7],
      ["acme/web", 7],
    ]);
  });
});

describe("GET /api/work/items set: the round sets", () => {
  it("lists the one pull request with the highest round 2", async () => {
    const { app } = await appWith([
      gate({ pr: 1 }),
      gate({ pr: 2 }),
      gate({ pr: 3 }),
      gate({ pr: 3, round: 2 }),
      gate({ pr: 4 }),
      gate({ pr: 4, round: 2 }),
      gate({ pr: 4, round: 3 }),
    ]);
    const two = await rows(app, "set=round_2");
    expect(numbers(two)).toEqual([["acme/app", 3]]);
    expect(detailOf(two)).toEqual([{ type: "round", round: 2 }]);
    expect(numbers(await rows(app, "set=round_1"))).toEqual([
      ["acme/app", 2],
      ["acme/app", 1],
    ]);
    expect(numbers(await rows(app, "set=round_3"))).toEqual([["acme/app", 4]]);
  });
});

describe("GET /api/work/items set: escalated", () => {
  it("lists the pull requests with their events oldest first, and counts the events", async () => {
    const { app } = await appWith([
      escalated(40, "sensitive", "authority", 30),
      escalated(40, "general", "sensitive", 10),
      escalated(41, "general", "sensitive", 20),
    ]);
    const page = await rows(app, "set=escalated");
    expect(page.events).toBe(3);
    expect(numbers(page)).toEqual([
      ["acme/app", 41],
      ["acme/app", 40],
    ]);
    expect(detailOf(page)[1]).toEqual({
      type: "escalations",
      events: [
        { pathTier: "general", finalTier: "sensitive" },
        { pathTier: "sensitive", finalTier: "authority" },
      ],
    });
    const dash = await dashOf(app);
    expect(dash.reviewHealth.escalations).toBe(3);
  });
});

describe("GET /api/work/items set: waivers", () => {
  it("lists the pull requests with their Waiver IDs, and counts distinct Waivers", async () => {
    const { app } = await appWith([
      waiver(4, "W-1"),
      waiver(5, "W-1"),
      waiver(5, "W-2"),
      waiver(9, "W-1", "acme/web"),
    ]);
    const page = await rows(app, "set=waivers");
    expect(numbers(page)).toEqual([
      ["acme/app", 5],
      ["acme/app", 4],
      ["acme/web", 9],
    ]);
    expect(detailOf(page)[0]).toEqual({ type: "waivers", ids: ["W-1", "W-2"] });
    // W-1 of acme/app, W-2 of acme/app and W-1 of acme/web.
    expect(page.events).toBe(3);
    const dash = await dashOf(app);
    expect(dash.reviewHealth.waiversInUse).toBe(3);
  });
});

describe("GET /api/work/items set: rows of a review set", () => {
  it("shows a counted pull request with no cache row as a bare row", async () => {
    await connect(APP, "acme/app");
    const { app } = await appWith([gate({ pr: 12 })]);
    const page = await rows(app, "set=round_1");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      repoId: APP,
      fullName: "acme/app",
      issue: null,
      pullRequest: null,
      context: { kind: "review", pullRequest: 12, link: null },
    });
  });

  it("shows the issue with the pull request of the event, not the Linked pull request", async () => {
    await connect(APP, "acme/app");
    await cachedIssue(APP, 12);
    await cachedPull(APP, 40, { linkedIssue: 12, state: "closed" });
    await cachedPull(APP, 44, { linkedIssue: 12 });
    const { app } = await appWith([gate({ pr: 40 })]);
    const page = await rows(app, "set=round_1");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.issue?.number).toBe(12);
    expect(page.items[0]?.pullRequest?.number).toBe(40);
  });

  it("shows a cached pull request with no cached issue, with its link", async () => {
    await connect(APP, "acme/app");
    await cachedPull(APP, 40, { link: "https://github.com/acme/app/pull/40" });
    const { app } = await appWith([gate({ pr: 40 })]);
    const page = await rows(app, "set=round_1");
    expect(page.items[0]).toMatchObject({
      issue: null,
      pullRequest: { number: 40 },
      context: { link: "https://github.com/acme/app/pull/40" },
    });
  });

  it("drops a link to another host", async () => {
    await connect(APP, "acme/app");
    await cachedPull(APP, 40, { link: "https://evil.example/acme/app/pull/40" });
    const { app } = await appWith([gate({ pr: 40 })]);
    const page = await rows(app, "set=round_1");
    expect(page.items[0]?.context).toMatchObject({ link: null });
  });

  it("shows a repo that is not in the repo list only in the scope All", async () => {
    const { app } = await appWith([
      gate({ pr: 3, repo: "other/unlisted" }),
      gate({ pr: 4, repo: "acme/app" }),
    ]);
    const all = await rows(app, "set=round_1");
    expect(all.items.map((row) => [row.repoId, row.fullName])).toEqual([
      [APP, "acme/app"],
      [null, "other/unlisted"],
    ]);
    const client = await rows(app, "set=round_1&client=acme");
    expect(numbers(client)).toEqual([["acme/app", 4]]);
  });

  it("uses the events of the repos of the client in a client scope", async () => {
    const { app } = await appWith([
      gate({ pr: 1, repo: "acme/app" }),
      gate({ pr: 2, repo: "globex/portal" }),
    ]);
    expect(numbers(await rows(app, "set=round_1&client=globex"))).toEqual([["globex/portal", 2]]);
  });

  it("matches the repo of an event with no regard to case", async () => {
    const { app } = await appWith([gate({ pr: 1, repo: "Acme/App" })]);
    const page = await rows(app, "set=round_1");
    expect(page.items[0]).toMatchObject({ repoId: APP, fullName: "acme/app" });
  });
});

describe("GET /api/work/items set: sources.controls", () => {
  it("is missing with no controls folder, with no rows and no events", async () => {
    const { app } = await appWith([]);
    const page = await rows(app, "set=escalated");
    expect(page.sources).toEqual({ runs: "missing", controls: "missing" });
    expect(page.items).toEqual([]);
    expect(page.events).toBe(0);
  });

  it("is ok with a readable folder", async () => {
    const { app } = await appWith([gate({ pr: 1 })]);
    expect((await rows(app, "set=round_1")).sources).toEqual({ runs: "missing", controls: "ok" });
  });

  it("is unreadable with a folder that the API cannot read", async () => {
    const { app, factory } = await appWith([gate({ pr: 1 })]);
    await chmod(path.join(factory, "controls"), 0o000);
    try {
      const page = await rows(app, "set=round_1");
      expect(page.sources).toEqual({ runs: "missing", controls: "unreadable" });
      expect(page.items).toEqual([]);
    } finally {
      await chmod(path.join(factory, "controls"), 0o755);
    }
  });
});
