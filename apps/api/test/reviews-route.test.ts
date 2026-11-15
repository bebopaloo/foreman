import path from "node:path";
import { schema } from "@foreman/db";
import { ReviewsPullRequestsResponse, ReviewsResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { gateEvent, isoSeconds, minutesAgo, nightLine, NOW, writeJsonl } from "./dash-fixtures.ts";
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
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_forge_files`,
  );
});

const APP = repoId("github.com", "acme", "app");
const WEB = repoId("github.com", "acme", "web");
const PORTAL = repoId("github.com", "globex", "portal");
const TOKENS = { "github.com/acme": "t", "github.com/globex": "t" };
const TODAY = "2026-11-15";

interface Setup {
  repos?: unknown[];
  controls?: (Record<string, unknown> | string)[];
  runs?: Record<string, unknown>[];
  logins?: string[];
}

async function appFor({ repos, controls = [], runs = [], logins = [] }: Setup = {}) {
  const claudeDir = await makeClaudeDir({
    repos: repos ?? [
      entry("acme/app", "acme"),
      entry("acme/web", "acme"),
      entry("globex/portal", "globex"),
    ],
  });
  const tokensFile = await writeTokens(claudeDir, TOKENS);
  const factory = path.join(claudeDir, "factory");
  if (controls.length > 0) await writeJsonl(factory, "controls", TODAY, controls);
  if (runs.length > 0) await writeJsonl(factory, "runs", TODAY, runs);
  const config = {
    ...testConfig,
    FOREMAN_CLAUDE_DIR: claudeDir,
    FOREMAN_TOKENS_FILE: tokensFile,
    FOREMAN_FACTORY_LOGINS: logins,
  };
  return buildApp({ config, db: database.db, logger: false, now: () => NOW });
}

type App = Awaited<ReturnType<typeof appFor>>;

async function get(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function reviews(app: App, query = "") {
  const { status, body } = await get(app, `/api/reviews${query}`);
  expect(status).toBe(200);
  return ReviewsResponse.parse(body);
}

async function rows(app: App, query = "") {
  const { status, body } = await get(app, `/api/reviews/pull-requests${query}`);
  expect(status).toBe(200);
  return ReviewsPullRequestsResponse.parse(body);
}

const at = (minutes: number) => isoSeconds(minutesAgo(minutes));

function gate(pr: number, minutes: number, over: Record<string, unknown> = {}) {
  return gateEvent({ pr, issue: pr, time: at(minutes), ...over });
}

async function cacheRepo(id: string, owner: string, name: string, forgeState = OK_STATE) {
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState,
    lastGoodFetchAt: NOW,
  });
}

describe("GET /api/reviews tiles", () => {
  it("shows the four tiles with their counts", async () => {
    const app = await appFor({
      controls: [
        gate(1, 100, { tier: "general", decision: "pass" }),
        gate(2, 99, { tier: "general", decision: "fail" }),
        {
          kind: "escalated",
          repo: "acme/app",
          time: at(98),
          pr: 2,
          issue: 2,
          path_tier: "general",
          tier: "sensitive",
          paths: [],
          evidence: "x",
        },
        gate(2, 97, { tier: "sensitive", round: 2, decision: "pass" }),
        gate(3, 96, { tier: null, decision: "pass" }),
        gate(4, 95, { tier: "authority", decision: "fail" }),
      ],
    });
    await cacheRepo(APP, "acme", "app");
    const body = await reviews(app);
    expect(body.tiles).toEqual({
      pullRequestsReviewed: { count: 4 },
      firstRoundPass: { percent: 50, passed: 2, total: 4 },
      escalationRate: { percent: 33, escalated: 1, withTier: 3 },
      reviewShare: { percent: null, builds: 0 },
    });
    expect(body.state).toBe("ok");
    expect(body.tierResults.byFinalTier).toEqual({
      authority: 1,
      sensitive: 1,
      general: 1,
      inert: 0,
      none: 1,
    });
  });

  it("shows no data with no gate event", async () => {
    const app = await appFor();
    await cacheRepo(APP, "acme", "app");
    const body = await reviews(app);
    expect(body.tiles).toEqual({
      pullRequestsReviewed: { count: 0 },
      firstRoundPass: { percent: null, passed: 0, total: 0 },
      escalationRate: { percent: null, escalated: 0, withTier: 0 },
      reviewShare: { percent: null, builds: 0 },
    });
    expect(body.rounds).toEqual([]);
  });

  it("is not connected when no repo in scope has cache rows", async () => {
    const app = await appFor({ controls: [gate(1, 100)] });
    const body = await reviews(app);
    expect(body.state).toBe("not_connected");
    expect(body.complete).toBe(3);
  });
});

describe("GET /api/reviews merges, rounds and findings", () => {
  it("counts merges by base and tier", async () => {
    const merged = (base: string, tier: string | null, minutes: number) => ({
      kind: "merged",
      repo: "acme/app",
      time: at(minutes),
      pr: 1,
      issue: null,
      base,
      tier,
    });
    const app = await appFor({
      controls: [
        merged("main", "general", 100),
        merged("main", "general", 99),
        merged("main", "general", 98),
        merged("feature/export", "authority", 97),
        merged("feature/ledger", "authority", 96),
        merged("main", null, 95),
      ],
    });
    const body = await reviews(app);
    expect(body.tierResults.merges).toEqual([
      { base: "main", authority: 0, sensitive: 0, general: 3, inert: 0, none: 1 },
      { base: "feature/*", authority: 2, sensitive: 0, general: 0, inert: 0, none: 0 },
    ]);
  });

  it("counts the rounds to settle", async () => {
    const app = await appFor({
      controls: [
        gate(1, 100, { tier: "sensitive", decision: "pass" }),
        gate(2, 99, { tier: "sensitive", decision: "fail" }),
        gate(2, 98, { tier: "sensitive", round: 2, decision: "pass" }),
        gate(3, 97, { tier: "sensitive", decision: "wait" }),
      ],
    });
    const body = await reviews(app);
    expect(body.rounds).toEqual([
      {
        tier: "sensitive",
        pullRequests: 3,
        settledInRound: [1, 1, 0],
        blocked: 0,
        notSettled: 1,
        withDecision: 2,
        lastGatePassPercent: 100,
      },
    ]);
  });

  it("reads the findings in the mode of the URL", async () => {
    const app = await appFor({
      controls: [
        gate(42, 100, {
          tier: "sensitive",
          decision: "fail",
          matrix: { Security: { major: 1, minor: 2 } },
        }),
        gate(42, 99, {
          tier: "sensitive",
          round: 2,
          decision: "pass",
          matrix: { Security: { minor: 1 } },
        }),
      ],
    });
    const first = await reviews(app);
    expect(first.findings.mode).toBe("round1");
    expect(first.findings.security.bySeverity.major).toEqual({ sensitive: 1, total: 1 });
    expect(first.findings.security.bySeverity.minor).toEqual({ sensitive: 2, total: 2 });
    const settle = await reviews(app, "?mode=settle");
    expect(settle.findings.mode).toBe("settle");
    expect(settle.findings.security.bySeverity.major).toEqual({ total: 0 });
    expect(settle.findings.security.bySeverity.minor).toEqual({ sensitive: 1, total: 1 });
  });

  it("lists a Security signal in a low tier with its link from the Work cache", async () => {
    const app = await appFor({
      controls: [
        gate(46, 100, { tier: "general", matrix: { Security: { minor: 1 } } }),
        gate(48, 99, { tier: "sensitive", matrix: { Security: { major: 1 } } }),
      ],
    });
    await cacheRepo(APP, "acme", "app");
    await database.db.insert(schema.workPullRequests).values({
      repoId: APP,
      number: 46,
      title: "Synthetic",
      state: "open",
      draft: false,
      headBranch: "b",
      baseBranch: "main",
      author: "synth",
      checks: "success",
      labels: [],
      link: "https://github.com/acme/app/pull/46",
      lastListedAt: NOW,
    });
    const body = await reviews(app);
    expect(body.findings.signals).toEqual([
      {
        repoId: APP,
        repo: "acme/app",
        pr: 46,
        tier: "general",
        blocker: 0,
        major: 0,
        minor: 1,
        link: "https://github.com/acme/app/pull/46",
      },
    ]);
  });

  it("rejects an unknown mode and an unknown query key", async () => {
    const app = await appFor();
    expect((await get(app, "/api/reviews?mode=other")).status).toBe(400);
    expect((await get(app, "/api/reviews?other=1")).status).toBe(400);
  });
});

describe("GET /api/reviews repos with no Control events", () => {
  const OFF = {
    mainBranch: null,
    controls: { state: "ok", profile: "p", modules: ["risk_tiers"] },
    releases: null,
  };
  const ON = { ...OFF, controls: { state: "ok", profile: "p", modules: ["control_events"] } };

  async function config(id: string, fields: unknown) {
    await database.db.insert(schema.workForgeFiles).values({
      repoId: id,
      path: ".claude/factory.json",
      fetchedAt: NOW,
      state: "ok",
      fields,
    });
  }

  it("lists a repo whose module is off and a repo with no events and no module data", async () => {
    const app = await appFor({
      controls: [gate(1, 100), gate(2, 99, { repo: "acme/web" })],
      logins: ["factory-bot"],
    });
    await cacheRepo(APP, "acme", "app");
    await cacheRepo(WEB, "acme", "web");
    await cacheRepo(PORTAL, "globex", "portal");
    await config(WEB, OFF);
    await config(APP, ON);
    const body = await reviews(app);
    expect(body.eventsOff).toEqual([
      { repoId: WEB, repo: "acme/web", reason: "module_off", reviewed: 0, unreviewed: 0 },
      { repoId: PORTAL, repo: "globex/portal", reason: "no_events", reviewed: 0, unreviewed: 0 },
    ]);
    expect(body.factoryLoginSet).toBe(true);
  });

  it("leaves the Factory identity counts empty with no login", async () => {
    const app = await appFor();
    await cacheRepo(PORTAL, "globex", "portal");
    const body = await reviews(app, "");
    expect(body.eventsOff.find((row) => row.repoId === PORTAL)).toEqual({
      repoId: PORTAL,
      repo: "globex/portal",
      reason: "no_events",
      reviewed: null,
      unreviewed: null,
    });
  });

  it("does not list a repo that is not connected", async () => {
    const app = await appFor();
    await cacheRepo(PORTAL, "globex", "portal", "not connected: no token");
    expect((await reviews(app)).eventsOff).toEqual([]);
  });
});

describe("reviews in a client scope", () => {
  it("uses only the events of the repos of the client", async () => {
    const app = await appFor({
      controls: [gate(1, 100, { tier: "general" }), gate(7, 99, { repo: "globex/portal" })],
    });
    await cacheRepo(APP, "acme", "app");
    expect((await reviews(app)).tiles.pullRequestsReviewed.count).toBe(2);
    expect((await reviews(app, "?client=acme")).tiles.pullRequestsReviewed.count).toBe(1);
    expect((await reviews(app, "?client=globex")).tiles.pullRequestsReviewed.count).toBe(1);
  });

  it("refuses an unknown client and a repo outside the client", async () => {
    const app = await appFor();
    expect((await get(app, "/api/reviews?client=nobody")).status).toBe(400);
    expect((await get(app, `/api/reviews/pull-requests?client=acme&repo=${PORTAL}`)).status).toBe(
      400,
    );
  });
});

describe("malformed events", () => {
  it("skips a line that is not valid and counts it", async () => {
    const app = await appFor({
      controls: [gate(1, 100), "not json", { kind: "gate", repo: "acme/app" }],
    });
    const body = await reviews(app);
    expect(body.tiles.pullRequestsReviewed.count).toBe(1);
    expect(body.skipped.controlEvents).toBe(2);
  });
});

function build(issue: number, startMinutes: number, minutes: number, pr: number) {
  return [
    nightLine({ issue, time: at(startMinutes) }),
    nightLine({
      issue,
      from: "IN REVIEW",
      to: "DONE",
      reason: `merged #${pr.toString()}`,
      time: at(startMinutes - minutes),
    }),
  ];
}

describe("GET /api/reviews/pull-requests", () => {
  it("shows a row with the build time, the Review cycle and the link", async () => {
    const app = await appFor({
      runs: build(12, 120, 60, 40),
      controls: [
        gate(40, 90, { issue: 12, tier: "sensitive", decision: "fail" }),
        gate(40, 70, { issue: 12, tier: "sensitive", round: 2, decision: "pass" }),
      ],
    });
    await cacheRepo(APP, "acme", "app");
    await database.db.insert(schema.workPullRequests).values({
      repoId: APP,
      number: 40,
      title: "Synthetic",
      state: "open",
      draft: false,
      headBranch: "b",
      baseBranch: "main",
      author: "synth",
      checks: "success",
      labels: [],
      link: "https://github.com/acme/app/pull/40",
      lastListedAt: NOW,
    });
    const page = await rows(app);
    expect(page.items).toEqual([
      {
        repoId: APP,
        repo: "acme/app",
        number: 40,
        issue: 12,
        finalTier: "sensitive",
        pathTier: "sensitive",
        escalated: false,
        rounds: 2,
        outcome: "pass",
        buildSeconds: 1800,
        buildEndSource: "first gate event",
        reviewCycleSeconds: 1800,
        split: null,
        totalSeconds: 3600,
        link: "https://github.com/acme/app/pull/40",
      },
    ]);
    const body = await reviews(app);
    expect(body.times).toMatchObject({
      byTier: [{ tier: "sensitive", pullRequests: 1, timed: 0, medianBuildSeconds: null }],
      noBuildEnd: 0,
      notTimed: 0,
      noPullRequest: 0,
    });
  });

  it("shows a build of a repo with no Control events with no tier and no rounds", async () => {
    const app = await appFor({ runs: build(12, 120, 60, 40) });
    const [row] = (await rows(app)).items;
    expect(row).toMatchObject({
      number: 40,
      finalTier: null,
      rounds: null,
      outcome: null,
      buildEndSource: null,
      buildSeconds: null,
      totalSeconds: 3600,
    });
    expect((await reviews(app)).times.noBuildEnd).toBe(1);
  });

  it("pages 120 rows by the longest total time, 50 at a time", async () => {
    const runs = Array.from({ length: 120 }, (_, index) =>
      build(index + 1, 600, index + 1, index + 1),
    ).flat();
    const app = await appFor({ runs });
    const first = await rows(app);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.totalSeconds).toBe(120 * 60);
    expect(first.items[49]?.totalSeconds).toBe(71 * 60);
    expect(first.nextCursor).not.toBeNull();
    const second = await rows(app, `?cursor=${first.nextCursor ?? ""}`);
    expect(second.items).toHaveLength(50);
    expect(second.items[0]?.totalSeconds).toBe(70 * 60);
    const third = await rows(app, `?cursor=${second.nextCursor ?? ""}`);
    expect(third.items).toHaveLength(20);
    expect(third.nextCursor).toBeNull();
    expect((await rows(app, "?limit=200")).items).toHaveLength(120);
  });

  it("filters by tier and by repo", async () => {
    const app = await appFor({
      runs: [...build(12, 120, 60, 40), ...build(13, 120, 30, 41)],
      controls: [gate(40, 90, { issue: 12, tier: "sensitive" })],
    });
    expect((await rows(app, "?tier=sensitive")).items.map((row) => row.number)).toEqual([40]);
    expect((await rows(app, "?tier=none")).items.map((row) => row.number)).toEqual([41]);
    expect((await rows(app, `?repo=${APP}`)).items).toHaveLength(2);
    expect((await rows(app, `?repo=${WEB}`)).items).toHaveLength(0);
  });

  it("rejects a bad limit, a bad tier, an unknown key and a bad cursor", async () => {
    const app = await appFor({ runs: build(12, 120, 60, 40) });
    for (const query of [
      "?limit=201",
      "?limit=0",
      "?tier=extreme",
      "?other=1",
      "?cursor=not-a-cursor!",
      `?cursor=${Buffer.from("{}").toString("base64url")}`,
    ]) {
      expect((await get(app, `/api/reviews/pull-requests${query}`)).status, query).toBe(400);
    }
  });
});
