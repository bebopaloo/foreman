import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { projectId } from "../src/usage/projects.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table turns, projects, refresh_runs, skill_calls, user_messages, agents`,
  );
});

const ACME = "/synthetic/acme/app";
const OTHER = "/synthetic/elsewhere/thing";

let counter = 0;

interface TurnSeed {
  session: string;
  time: string;
  tokens?: number;
  project?: string;
  agentType?: string;
  agentId?: string | null;
  skill?: string | null;
  basis?: string | null;
}

async function turn(seed: TurnSeed) {
  counter += 1;
  const project = seed.project ?? ACME;
  await database.db
    .insert(schema.projects)
    .values({ projectKey: project, noRepo: false })
    .onConflictDoNothing();
  await database.db.insert(schema.turns).values({
    turnKey: `t${String(counter)}`,
    sessionId: seed.session,
    time: new Date(seed.time),
    model: "claude-synthetic-1",
    speed: null,
    serviceTier: null,
    inputTokens: seed.tokens ?? 100,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearchCount: 0,
    projectKey: project,
    branch: "main",
    agentType: seed.agentType ?? "main",
    agentId: seed.agentId ?? null,
    skillName: seed.skill ?? null,
    skillBasis: seed.basis ?? (seed.skill === undefined || seed.skill === null ? null : "exact"),
  });
}

async function message(session: string, time: string, project = ACME) {
  counter += 1;
  await database.db.insert(schema.userMessages).values({
    recordId: `m${String(counter)}`,
    sessionId: session,
    time: new Date(time),
    projectKey: project,
    branch: null,
  });
}

async function skillCall(session: string, skillName: string, time: string, project = ACME) {
  counter += 1;
  await database.db.insert(schema.skillCalls).values({
    callId: `c${String(counter)}`,
    sessionId: session,
    agentId: null,
    messageId: null,
    time: new Date(time),
    skillName,
    projectKey: project,
  });
}

async function get(url: string, repoList?: unknown) {
  const claudeDir = await makeClaudeDir(
    repoList ?? { repos: [entry("acme/app", "acme"), entry("globex/web", "globex")] },
  );
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
  const app = await buildApp({ config, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

interface Session {
  id: string;
  name: string | null;
  kind: string;
  start: string;
  end: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
  projects: { id: string; label: string }[];
  projectCount: number;
  tokens: number;
  turns: number;
  userMessages: number;
}

interface Body {
  sessions: Session[];
  total: number;
  nextCursor: string | null;
}

async function list(query: string, repoList?: unknown) {
  const response = await get(`/api/sessions?${query}`, repoList);
  return { status: response.statusCode, body: response.json<Body>() };
}

const DAY = "day=2026-11-14&tz=UTC";

describe("the sessions of one day", () => {
  it("lists the sessions of the day, newest start first, with their numbers", async () => {
    await turn({ session: "s1", time: "2026-11-14T08:00:00Z", tokens: 10 });
    await turn({ session: "s1", time: "2026-11-14T08:30:00Z", tokens: 20 });
    await turn({ session: "s2", time: "2026-11-14T10:00:00Z" });
    await turn({ session: "s3", time: "2026-11-14T09:00:00Z" });
    await turn({ session: "s4", time: "2026-11-13T09:00:00Z" });
    await message("s1", "2026-11-14T07:59:00Z");
    await message("s1", "2026-11-14T08:10:00Z");
    await message("s1", "2026-11-13T08:10:00Z");

    const { status, body } = await list(DAY);

    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.nextCursor).toBeNull();
    expect(body.sessions.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
    const s1 = body.sessions[2];
    expect(s1).toEqual({
      id: "s1",
      name: null,
      kind: "session",
      start: "2026-11-14T08:00:00.000Z",
      end: "2026-11-14T08:30:00.000Z",
      continuesBefore: false,
      continuesAfter: false,
      projects: [{ id: projectId(ACME), label: "app" }],
      projectCount: 1,
      tokens: 30,
      turns: 2,
      userMessages: 2,
    });
  });

  it("sorts sessions with the same start by session ID", async () => {
    await turn({ session: "b", time: "2026-11-14T08:00:00Z" });
    await turn({ session: "a", time: "2026-11-14T08:00:00Z" });
    const { body } = await list(DAY);
    expect(body.sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("uses the day in the time zone of the request", async () => {
    await turn({ session: "s1", time: "2026-11-14T23:30:00Z" });
    await turn({ session: "s1", time: "2026-11-14T23:50:00Z" });
    const berlin = await list("day=2026-11-15&tz=Europe/Berlin");
    expect(berlin.body.sessions).toHaveLength(1);
    expect(berlin.body.sessions[0]?.start).toBe("2026-11-14T23:30:00.000Z");
    const utc = await list("day=2026-11-15&tz=UTC");
    expect(utc.body.sessions).toHaveLength(0);
    expect(utc.body.total).toBe(0);
  });

  it("cuts a session that crosses midnight to the turns of the day", async () => {
    for (const time of [
      "2026-11-13T23:30:00Z",
      "2026-11-13T23:50:00Z",
      "2026-11-14T00:10:00Z",
      "2026-11-14T00:40:00Z",
    ]) {
      await turn({ session: "s1", time, tokens: 1000 });
    }
    const next = (await list(DAY)).body.sessions[0];
    expect(next).toMatchObject({
      start: "2026-11-14T00:10:00.000Z",
      end: "2026-11-14T00:40:00.000Z",
      tokens: 2000,
      continuesBefore: true,
      continuesAfter: false,
    });
    const before = (await list("day=2026-11-13&tz=UTC")).body.sessions[0];
    expect(before).toMatchObject({
      start: "2026-11-13T23:30:00.000Z",
      end: "2026-11-13T23:50:00.000Z",
      tokens: 2000,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it("lists up to 3 projects, the one with most tokens first", async () => {
    const projects = ["/synthetic/p/a", "/synthetic/p/b", "/synthetic/p/c", "/synthetic/p/d"];
    for (const [index, project] of projects.entries()) {
      await turn({
        session: "s1",
        time: "2026-11-14T08:00:00Z",
        project,
        tokens: 10 * (index + 1),
      });
    }
    const session = (await list(DAY)).body.sessions[0];
    expect(session?.projectCount).toBe(4);
    expect(session?.projects.map((p) => p.label)).toEqual(["d", "c", "b"]);
  });
});

describe("the name and the kind of a session", () => {
  it("names a session by its first skill and gives the kind of the loop", async () => {
    await turn({ session: "A", time: "2026-11-14T08:00:00Z", skill: "factory-core:factory-run" });
    await turn({ session: "A", time: "2026-11-14T08:10:00Z", skill: "factory-core:to-code" });
    await skillCall("A", "factory-core:factory-run", "2026-11-14T07:59:00Z");
    await skillCall("A", "factory-core:to-code", "2026-11-14T08:09:00Z");
    await turn({
      session: "B",
      time: "2026-11-14T09:00:00Z",
      skill: "factory-core:factory-next",
      basis: "estimate",
    });
    await skillCall("B", "factory-core:factory-next", "2026-11-14T08:59:00Z");
    await turn({ session: "C", time: "2026-11-14T10:00:00Z" });

    const byId = new Map((await list(DAY)).body.sessions.map((s) => [s.id, s]));

    expect(byId.get("A")).toMatchObject({
      name: "factory-core:factory-run",
      kind: "unattended-loop",
    });
    expect(byId.get("B")).toMatchObject({
      name: "factory-core:factory-next",
      kind: "attended-loop",
    });
    expect(byId.get("C")).toMatchObject({ name: null, kind: "session" });
  });

  it("skips an ambiguous skill and a turn with no skill when it picks the name", async () => {
    await turn({ session: "A", time: "2026-11-14T08:00:00Z" });
    await turn({
      session: "A",
      time: "2026-11-14T08:01:00Z",
      skill: "(ambiguous)",
      basis: "estimate",
    });
    await turn({ session: "A", time: "2026-11-14T08:02:00Z", skill: "review-spec" });
    expect((await list(DAY)).body.sessions[0]?.name).toBe("review-spec");
  });

  it("takes the kind from a skill call of another day and of the main conversation only", async () => {
    await turn({ session: "A", time: "2026-11-14T08:00:00Z" });
    await skillCall("A", "factory-run", "2026-11-12T08:00:00Z");
    await turn({ session: "B", time: "2026-11-14T08:00:00Z" });
    counter += 1;
    await database.db.insert(schema.skillCalls).values({
      callId: `c${String(counter)}`,
      sessionId: "B",
      agentId: "agent-1",
      messageId: null,
      time: new Date("2026-11-14T08:00:00Z"),
      skillName: "factory-run",
      projectKey: ACME,
    });
    const byId = new Map((await list(DAY)).body.sessions.map((s) => [s.id, s]));
    expect(byId.get("A")?.kind).toBe("unattended-loop");
    expect(byId.get("B")?.kind).toBe("session");
  });
});

describe("the sessions of a client scope", () => {
  async function seedNight() {
    await turn({ session: "n1", time: "2026-11-14T22:00:00Z", project: OTHER, tokens: 5000 });
    await message("n1", "2026-11-14T21:59:00Z", OTHER);
    await message("n1", "2026-11-14T21:59:30Z", OTHER);
    await message("n1", "2026-11-14T21:59:40Z", OTHER);
    await skillCall("n1", "factory-core:factory-run", "2026-11-14T21:58:00Z", OTHER);
    await skillCall("n1", "factory-core:to-code", "2026-11-14T22:30:00Z", OTHER);
    await turn({
      session: "n1",
      time: "2026-11-14T22:31:00Z",
      project: ACME,
      tokens: 1000,
      agentType: "software-developer",
      agentId: "a1",
      skill: "factory-core:to-code",
    });
    await turn({
      session: "n1",
      time: "2026-11-14T22:40:00Z",
      project: ACME,
      tokens: 1000,
      agentType: "software-developer",
      agentId: "a2",
      skill: "factory-core:to-code",
    });
  }

  it("counts only the turns and the messages in scope, and shows the session", async () => {
    await seedNight();
    const { body } = await list(`${DAY}&client=acme`);
    expect(body.total).toBe(1);
    expect(body.sessions[0]).toMatchObject({
      id: "n1",
      tokens: 2000,
      turns: 2,
      userMessages: 0,
      start: "2026-11-14T22:31:00.000Z",
      projectCount: 1,
    });
  });

  it("keeps the kind of the whole session and names it by the first turn in scope", async () => {
    await seedNight();
    const session = (await list(`${DAY}&client=acme`)).body.sessions[0];
    expect(session).toMatchObject({ kind: "unattended-loop", name: "factory-core:to-code" });
  });

  it("leaves out a session that has no turn in scope", async () => {
    await seedNight();
    const { status, body } = await list(`${DAY}&client=globex`);
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.sessions).toEqual([]);
  });

  it("refuses a client that is not in the repo list", async () => {
    const response = await get(`/api/sessions?${DAY}&client=nobody`);
    expect(response.statusCode).toBe(400);
  });
});

describe("paging of sessions", () => {
  it("pages 120 sessions as 50, 50 and 20", async () => {
    await database.db.insert(schema.turns).values(
      Array.from({ length: 120 }, (_, index) => ({
        turnKey: `bulk${String(index)}`,
        sessionId: `s${String(index).padStart(3, "0")}`,
        time: new Date(Date.UTC(2026, 10, 14, 0, 0, index)),
        model: "claude-synthetic-1",
        inputTokens: 1,
        outputTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
        webSearchCount: 0,
        projectKey: ACME,
        agentType: "main",
      })),
    );
    const sizes: number[] = [];
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? DAY : `${DAY}&cursor=${cursor}`;
      const { body } = await list(query);
      sizes.push(body.sessions.length);
      ids.push(...body.sessions.map((s) => s.id));
      expect(body.total).toBe(120);
      cursor = body.nextCursor;
    } while (cursor !== null);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
  });

  it("rejects a limit that is too big or too small and a cursor that is not valid", async () => {
    for (const bad of ["limit=201", "limit=0", "cursor=not-valid!"]) {
      expect((await get(`/api/sessions?${DAY}&${bad}`)).statusCode).toBe(400);
    }
  });

  it("rejects a cursor from another day", async () => {
    await turn({ session: "s1", time: "2026-11-14T08:00:00Z" });
    await turn({ session: "s2", time: "2026-11-14T09:00:00Z" });
    const first = await list(`${DAY}&limit=1`);
    expect(first.body.nextCursor).not.toBeNull();
    const other = await get(
      `/api/sessions?day=2026-11-13&tz=UTC&cursor=${first.body.nextCursor ?? ""}`,
    );
    expect(other.statusCode).toBe(400);
  });
});

describe("an invalid query", () => {
  it.each([
    ["no day", "tz=UTC"],
    ["no time zone", "day=2026-11-14"],
    ["a day that is not a date", "day=2026-02-30&tz=UTC"],
    ["an unknown time zone", "day=2026-11-14&tz=Mars/Base"],
    ["an offset as time zone", "day=2026-11-14&tz=%2B03:00"],
    ["an unknown field", "day=2026-11-14&tz=UTC&sort=name"],
    ["a client name that is not valid", "day=2026-11-14&tz=UTC&client=Acme%20Ltd"],
  ])("returns status 400 for %s", async (_name, query) => {
    expect((await get(`/api/sessions?${query}`)).statusCode).toBe(400);
  });
});
