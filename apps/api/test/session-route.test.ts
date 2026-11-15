import { schema } from "@foreman/db";
import { SessionResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { projectId } from "../src/usage/projects.ts";
import { repoId } from "../src/work/repo-list.ts";
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
    sql`truncate table turns, projects, refresh_runs, skill_calls, user_messages, agents, work_repos, work_issues`,
  );
});

const ACME = "/synthetic/acme/app";
const LOOSE = "/synthetic/loose/folder";
const ACME_APP = repoId("github.com", "acme", "app");
const DAY = "day=2026-11-14&tz=UTC";
const TOKENS: Record<string, string> = { "github.com/acme": "t", "github.com/globex": "t" };

let counter = 0;

interface TurnSeed {
  session?: string;
  time: string;
  project?: string;
  branch?: string | null;
  worktree?: string | null;
  agentType?: string;
  agentId?: string | null;
  skill?: string | null;
  basis?: string | null;
  model?: string;
  speed?: string | null;
  tokens?: number;
}

async function turn(seed: TurnSeed) {
  counter += 1;
  const project = seed.project ?? ACME;
  await database.db
    .insert(schema.projects)
    .values({ projectKey: project, noRepo: false })
    .onConflictDoNothing();
  await database.db.insert(schema.turns).values({
    turnKey: `t${String(counter).padStart(6, "0")}`,
    sessionId: seed.session ?? "s1",
    time: new Date(seed.time),
    model: seed.model ?? "claude-synthetic-1",
    speed: seed.speed ?? null,
    serviceTier: null,
    inputTokens: seed.tokens ?? 100,
    outputTokens: 10,
    cacheWrite5mTokens: 1,
    cacheWrite1hTokens: 2,
    cacheReadTokens: 3,
    webSearchCount: 0,
    projectKey: project,
    branch: seed.branch === undefined ? "main" : seed.branch,
    worktreeName: seed.worktree ?? null,
    agentType: seed.agentType ?? (seed.agentId === undefined ? "main" : "sub-agent (unknown)"),
    agentId: seed.agentId ?? null,
    skillName: seed.skill ?? null,
    skillBasis: seed.basis ?? (seed.skill === undefined || seed.skill === null ? null : "exact"),
  });
}

async function message(time: string, project = ACME, session = "s1") {
  counter += 1;
  await database.db.insert(schema.userMessages).values({
    recordId: `m${String(counter)}`,
    sessionId: session,
    time: new Date(time),
    projectKey: project,
    branch: null,
  });
}

async function issue(repo: string, number: number, title: string, link: string | null) {
  await database.db.insert(schema.workIssues).values({
    repoId: repo,
    number,
    title,
    state: "open",
    issueState: "READY",
    priority: "high",
    labels: [],
    author: "someone",
    link,
    parent: null,
    children: [],
    blockedBy: [],
    lastListedAt: new Date("2026-11-14T00:00:00Z"),
    detailsFetchedAt: null,
    detailsErrorClass: null,
  });
}

async function cachedRepo(
  id: string,
  owner: string,
  name: string,
  errorClass: string | null = null,
) {
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    client: null,
    forgePlugin: null,
    trackerPlugin: null,
    forgeState: "ok",
    forgeErrorClass: errorClass,
    trackerState: "ok",
    trackerErrorClass: null,
    lastGoodFetchAt: new Date("2026-11-14T00:00:00Z"),
  });
}

const DEFAULT_ENTRIES = [
  entry("acme/app", "acme"),
  entry("acme/web", "acme"),
  entry("globex/web", "globex"),
];

async function get(url: string, entries: unknown[] = DEFAULT_ENTRIES, tokens = TOKENS) {
  const claudeDir = await makeClaudeDir({ repos: entries });
  const tokensFile = await writeTokens(claudeDir, tokens);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  const app = await buildApp({ config, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

async function session(
  query = DAY,
  id = "s1",
  entries?: unknown[],
  tokens?: Record<string, string>,
) {
  const response = await get(`/api/sessions/${id}?${query}`, entries, tokens);
  expect(response.statusCode).toBe(200);
  return SessionResponse.parse(response.json<unknown>());
}

const times = (minutes: number[]) =>
  minutes.map((minute) => `2026-11-14T09:${String(minute).padStart(2, "0")}:00Z`);

describe("spans of the main conversation", () => {
  it("makes one span for each run of the same skill", async () => {
    for (const time of times([0, 5])) await turn({ time });
    await turn({ time: "2026-11-14T09:07:00Z", skill: "review-spec", basis: "estimate" });
    for (const minute of [8, 12, 20]) {
      await turn({ time: times([minute])[0] ?? "", skill: "review-spec", basis: "estimate" });
    }
    for (const time of times([26, 30])) await turn({ time });

    const { spans } = await session();

    expect(spans.map((s) => [s.kind, s.skill, s.skillBasis, s.turns, s.start, s.end])).toEqual([
      ["main", null, null, 2, "2026-11-14T09:00:00.000Z", "2026-11-14T09:05:00.000Z"],
      [
        "main",
        "review-spec",
        "estimate",
        4,
        "2026-11-14T09:07:00.000Z",
        "2026-11-14T09:20:00.000Z",
      ],
      ["main", null, null, 2, "2026-11-14T09:26:00.000Z", "2026-11-14T09:30:00.000Z"],
    ]);
    expect(spans[0]).toMatchObject({
      agentType: "main",
      inputTokens: 200,
      outputTokens: 20,
      cacheWriteTokens: 6,
      cacheReadTokens: 6,
      tokens: 232,
      project: { id: projectId(ACME), label: "app" },
    });
  });

  it("reports the ambiguous skill as it is", async () => {
    await turn({ time: "2026-11-14T09:00:00Z", skill: "(ambiguous)", basis: "estimate" });
    const { spans } = await session();
    expect(spans[0]).toMatchObject({ skill: "(ambiguous)", skillBasis: "estimate" });
  });

  it("starts a new main span when the work item changes", async () => {
    const base = { skill: "to-code", project: ACME } as const;
    await turn({ ...base, time: "2026-11-14T09:00:00Z", worktree: "212-add-refunds" });
    await turn({ ...base, time: "2026-11-14T09:05:00Z", worktree: "212-add-refunds" });
    await turn({ ...base, time: "2026-11-14T09:10:00Z", worktree: "213-fix-rounding" });

    const { spans } = await session();

    expect(
      spans.map((s) => [s.turns, s.workItem.kind === "one" ? s.workItem.number : null]),
    ).toEqual([
      [2, 212],
      [1, 213],
    ]);
  });
});

describe("spans of sub-agents", () => {
  it("makes one span for each sub-agent, in order of start time, with models", async () => {
    await turn({ time: "2026-11-14T09:00:00Z", skill: "to-code" });
    await turn({
      time: "2026-11-14T09:41:00Z",
      agentId: "r1",
      agentType: "review-finder",
      skill: "review-core",
    });
    await turn({
      time: "2026-11-14T09:08:00Z",
      agentId: "d1",
      agentType: "software-developer",
      skill: "to-code",
      model: "claude-sonnet-4-5",
    });
    for (let i = 0; i < 5; i += 1) {
      await turn({
        time: `2026-11-14T09:${String(10 + i)}:00Z`,
        agentId: "d1",
        agentType: "software-developer",
        skill: "to-code",
        model: "claude-sonnet-4-5",
      });
    }
    await turn({
      time: "2026-11-14T09:20:00Z",
      agentId: "d1",
      agentType: "software-developer",
      skill: "to-code",
      model: "claude-opus-4-1",
    });
    await turn({
      time: "2026-11-14T09:21:00Z",
      agentId: "d1",
      agentType: "software-developer",
      skill: "to-code",
      model: "claude-opus-4-1",
    });
    await turn({
      time: "2026-11-14T09:40:00Z",
      agentId: "d1",
      agentType: "software-developer",
      skill: "to-code",
      model: "claude-opus-4-1",
      speed: "fast",
    });
    await turn({
      time: "2026-11-14T09:45:00Z",
      agentId: "r2",
      agentType: "review-finder",
      skill: "review-core",
    });

    const { spans, spanTotal } = await session();

    expect(spanTotal).toBe(4);
    expect(spans.map((s) => s.key)).toEqual([expect.stringMatching(/^m:/), "a:d1", "a:r1", "a:r2"]);
    const developer = spans.find((s) => s.key === "a:d1");
    expect(developer).toMatchObject({
      kind: "sub-agent",
      agentType: "software-developer",
      skill: "to-code",
      turns: 9,
      start: "2026-11-14T09:08:00.000Z",
      end: "2026-11-14T09:40:00.000Z",
    });
    expect(developer?.models).toEqual([
      { model: "claude-sonnet-4-5", turns: 6 },
      { model: "claude-opus-4-1", turns: 2 },
      { model: "claude-opus-4-1 (fast)", turns: 1 },
    ]);
    expect(spans.filter((s) => s.agentType === "review-finder")).toHaveLength(2);
  });

  it("shows the Agent type sub-agent (unknown) for a sub-agent with no meta file", async () => {
    await turn({ time: "2026-11-14T09:00:00Z", agentId: "a1" });
    const { spans } = await session();
    expect(spans[0]).toMatchObject({ kind: "sub-agent", agentType: "sub-agent (unknown)" });
  });
});

describe("the work item of a span", () => {
  const link = "https://github.com/acme/app/issues/212";

  it("reads the worktree folder and the cached title and link", async () => {
    await cachedRepo(ACME_APP, "acme", "app");
    await issue(ACME_APP, 212, "Add refunds", link);
    await turn({
      time: "2026-11-14T09:00:00Z",
      agentId: "a1",
      worktree: "212-add-refunds",
      branch: "HEAD",
    });

    const { spans } = await session();

    expect(spans[0]?.workItem).toEqual({
      kind: "one",
      repoId: ACME_APP,
      fullName: "acme/app",
      number: 212,
      title: "Add refunds",
      link,
    });
  });

  it("reads the branch when the turn has no worktree", async () => {
    await turn({ time: "2026-11-14T09:00:00Z", branch: "209-fix-totals" });
    const { spans } = await session();
    expect(spans[0]?.workItem).toMatchObject({ kind: "one", number: 209, fullName: "acme/app" });
  });

  it("gives no work item for branches that do not name an issue", async () => {
    const branches = ["main", "HEAD", "feature/foreman-v1", "release/0.1", "0-draft"];
    for (const [index, branch] of branches.entries()) {
      await turn({
        time: `2026-11-14T09:0${String(index)}:00Z`,
        agentId: `a${String(index)}`,
        branch,
      });
    }
    await turn({
      time: "2026-11-14T09:10:00Z",
      agentId: "w",
      worktree: "brave-otter",
      branch: "worktree-brave-otter",
    });

    const { spans } = await session();

    expect(spans).toHaveLength(6);
    expect(spans.every((s) => s.workItem.kind === "none")).toBe(true);
  });

  it("takes the worktree folder before the branch", async () => {
    await turn({
      time: "2026-11-14T09:00:00Z",
      worktree: "212-add-refunds",
      branch: "209-fix-totals",
    });
    const { spans } = await session();
    expect(spans[0]?.workItem).toMatchObject({ kind: "one", number: 212 });
  });

  it("shows the number only for an issue that is not cached or a Project with no repo list entry", async () => {
    await cachedRepo(ACME_APP, "acme", "app");
    await turn({ time: "2026-11-14T09:00:00Z", agentId: "a1", worktree: "212-add-refunds" });
    await turn({ time: "2026-11-14T09:01:00Z", agentId: "a2", project: LOOSE, branch: "7-seven" });

    const { spans } = await session();

    expect(spans[0]?.workItem).toEqual({
      kind: "one",
      repoId: ACME_APP,
      fullName: "acme/app",
      number: 212,
      title: null,
      link: null,
    });
    expect(spans[1]?.workItem).toEqual({
      kind: "one",
      repoId: null,
      fullName: null,
      number: 7,
      title: null,
      link: null,
    });
  });

  it("shows a count for a sub-agent with two work items", async () => {
    await turn({ time: "2026-11-14T09:00:00Z", agentId: "a1", worktree: "212-add-refunds" });
    await turn({ time: "2026-11-14T09:01:00Z", agentId: "a1", worktree: "213-fix-rounding" });
    const { spans } = await session();
    expect(spans[0]?.workItem).toEqual({ kind: "several", count: 2 });
  });

  it("drops a link that is not https on the host of the repo", async () => {
    await cachedRepo(ACME_APP, "acme", "app");
    await issue(ACME_APP, 212, "Add refunds", "https://evil.example/x");
    await turn({ time: "2026-11-14T09:00:00Z", worktree: "212-add-refunds" });
    const { spans } = await session();
    expect(spans[0]?.workItem).toMatchObject({ title: "Add refunds", link: null });
  });

  it("shows no title for a repo with no token, and counts it as not complete", async () => {
    await cachedRepo(ACME_APP, "acme", "app");
    await issue(ACME_APP, 212, "Add refunds", "https://github.com/acme/app/issues/212");
    await turn({ time: "2026-11-14T09:00:00Z", worktree: "212-add-refunds" });

    const body = await session(DAY, "s1", [entry("acme/app", "acme")], {});

    expect(body.spans[0]?.workItem).toMatchObject({ number: 212, title: null, link: null });
    expect(body.complete).toEqual({ incompleteRepos: 1, notConnected: true });
  });

  it("counts the repos with no cache rows or a fetch error", async () => {
    await cachedRepo(ACME_APP, "acme", "app", "network");
    await turn({ time: "2026-11-14T09:00:00Z" });

    const body = await session(`${DAY}&client=acme`);

    // acme/app has a fetch error, acme/web has no cache rows.
    expect(body.complete).toEqual({ incompleteRepos: 2, notConnected: false });
  });

  it("is complete when every repo of the client has cache rows", async () => {
    await cachedRepo(ACME_APP, "acme", "app");
    await cachedRepo(repoId("github.com", "acme", "web"), "acme", "web");
    await turn({ time: "2026-11-14T09:00:00Z" });
    const body = await session(`${DAY}&client=acme`);
    expect(body.complete).toEqual({ incompleteRepos: 0, notConnected: false });
  });
});

describe("messages from the Operator", () => {
  it("lists the times of the messages and widens the window to them", async () => {
    await turn({ time: "2026-11-14T09:10:00Z" });
    await turn({ time: "2026-11-14T09:20:00Z" });
    await message("2026-11-14T09:00:00Z");
    await message("2026-11-14T09:15:00Z");
    await message("2026-11-14T09:30:00Z");
    await message("2026-11-13T09:30:00Z");

    const body = await session();

    expect(body.userMessages).toEqual([
      "2026-11-14T09:00:00.000Z",
      "2026-11-14T09:15:00.000Z",
      "2026-11-14T09:30:00.000Z",
    ]);
    expect(body.userMessageTotal).toBe(3);
    expect(body.session.userMessages).toBe(3);
    expect(body.window).toEqual({
      start: "2026-11-14T09:00:00.000Z",
      end: "2026-11-14T09:30:00.000Z",
    });
  });

  it("uses the first and last turn as the window when there are no messages", async () => {
    await turn({ time: "2026-11-14T09:10:00Z" });
    await turn({ time: "2026-11-14T09:20:00Z" });
    const body = await session();
    expect(body.window).toEqual({
      start: "2026-11-14T09:10:00.000Z",
      end: "2026-11-14T09:20:00.000Z",
    });
    expect(body.userMessages).toEqual([]);
    expect(body.userMessageTotal).toBe(0);
  });
});

describe("a client scope", () => {
  async function seed() {
    await message("2026-11-14T09:00:00Z", LOOSE);
    await message("2026-11-14T09:01:00Z", LOOSE);
    await message("2026-11-14T09:02:00Z", LOOSE);
    await turn({ time: "2026-11-14T09:00:00Z", project: LOOSE, skill: "factory-run" });
    for (const agent of ["a1", "a2"]) {
      await turn({
        time: "2026-11-14T09:10:00Z",
        agentId: agent,
        project: ACME,
        worktree: "212-add-refunds",
        tokens: 1000 - 16,
      });
    }
  }

  it("shows the sub-agent spans in scope and no main span", async () => {
    await seed();
    const body = await session(`${DAY}&client=acme`);
    expect(body.spans.map((s) => s.key)).toEqual(["a:a1", "a:a2"]);
    expect(body.session.tokens).toBe(2000);
    expect(body.session.userMessages).toBe(0);
    expect(body.userMessageTotal).toBe(0);
  });

  it("returns 404 for a client that has no turn of the session", async () => {
    await seed();
    const response = await get(`/api/sessions/s1?${DAY}&client=globex`);
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an unknown client", async () => {
    await seed();
    const response = await get(`/api/sessions/s1?${DAY}&client=nobody`);
    expect(response.statusCode).toBe(400);
  });
});

describe("an unknown session and invalid queries", () => {
  it("returns 404 for a session with no turn on the day", async () => {
    await turn({ time: "2026-11-13T09:00:00Z" });
    const response = await get(`/api/sessions/s1?${DAY}`);
    expect(response.statusCode).toBe(404);
    expect((await get(`/api/sessions/s9?${DAY}`)).statusCode).toBe(404);
  });

  it.each([
    ["a day that is not a date", "/api/sessions/s1?day=2026-02-30&tz=UTC"],
    ["an unknown time zone", "/api/sessions/s1?day=2026-11-14&tz=Mars/Base"],
    ["an unknown key", `/api/sessions/s1?${DAY}&extra=1`],
    ["a session ID of 65 characters", `/api/sessions/${"a".repeat(65)}?${DAY}`],
    ["a limit of 501", `/api/sessions/s1?${DAY}&limit=501`],
    ["a limit of 0", `/api/sessions/s1?${DAY}&limit=0`],
    ["a cursor that is not valid", `/api/sessions/s1?${DAY}&cursor=abc`],
  ])("returns 400 for %s", async (_name, url) => {
    await turn({ time: "2026-11-14T09:00:00Z" });
    expect((await get(url)).statusCode).toBe(400);
  });
});

describe("paging of spans", () => {
  it("pages 650 spans by 200 and rejects a cursor of another session", async () => {
    const rows = Array.from({ length: 650 }, (_, index) => ({
      turnKey: `p${String(index).padStart(4, "0")}`,
      sessionId: "s1",
      time: new Date(Date.UTC(2026, 10, 14, 0, 0, 0) + index * 1000),
      model: "claude-synthetic-1",
      speed: null,
      serviceTier: null,
      inputTokens: 1,
      outputTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      webSearchCount: 0,
      projectKey: ACME,
      branch: "main",
      worktreeName: null,
      agentType: "sub-agent (unknown)",
      agentId: `g${String(index).padStart(4, "0")}`,
      skillName: null,
      skillBasis: null,
    }));
    await database.db.insert(schema.projects).values({ projectKey: ACME, noRepo: false });
    await database.db.insert(schema.turns).values(rows);

    const sizes: number[] = [];
    const keys: string[] = [];
    let cursor: string | null = null;
    do {
      const query = cursor === null ? DAY : `${DAY}&cursor=${cursor}`;
      const body = await session(query);
      expect(body.spanTotal).toBe(650);
      sizes.push(body.spans.length);
      keys.push(...body.spans.map((s) => s.key));
      cursor = body.nextCursor;
    } while (cursor !== null);

    expect(sizes).toEqual([200, 200, 200, 50]);
    expect(new Set(keys).size).toBe(650);
    expect(keys).toEqual([...keys].sort());

    const first = await session(`${DAY}&limit=5`);
    await turn({ session: "s2", time: "2026-11-14T09:00:00Z" });
    const other = await get(`/api/sessions/s2?${DAY}&cursor=${first.nextCursor ?? ""}`);
    expect(other.statusCode).toBe(400);
  });
});
