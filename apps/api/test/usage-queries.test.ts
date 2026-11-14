import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { projectId } from "../src/usage/projects.ts";
import { openTestDatabase, testConfig } from "./database.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table turns, projects, refresh_runs`);
});

interface Seed {
  key: string;
  time: string;
  session?: string;
  model?: string;
  speed?: string | null;
  branch?: string | null;
  agentType?: string;
  input?: number;
  output?: number;
  write5m?: number;
  write1h?: number;
  read?: number;
}

let counter = 0;
async function seed(rows: Seed[]) {
  for (const row of rows) {
    counter += 1;
    await database.db
      .insert(schema.projects)
      .values({ projectKey: row.key, noRepo: false })
      .onConflictDoNothing();
    await database.db.insert(schema.turns).values({
      turnKey: `t${String(counter)}`,
      sessionId: row.session ?? "s1",
      time: new Date(row.time),
      model: row.model ?? "claude-synthetic-1",
      speed: row.speed ?? null,
      serviceTier: null,
      inputTokens: row.input ?? 1,
      outputTokens: row.output ?? 2,
      cacheWrite5mTokens: row.write5m ?? 0,
      cacheWrite1hTokens: row.write1h ?? 0,
      cacheReadTokens: row.read ?? 0,
      webSearchCount: 0,
      projectKey: row.key,
      branch: row.branch === undefined ? "main" : row.branch,
      agentType: row.agentType ?? "main",
    });
  }
}

async function get(url: string) {
  const app = await buildApp({ config: testConfig, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

const A = "/synthetic/a/app";
const B = "/synthetic/b/tool";
const range = "from=2026-11-01&to=2026-11-03&tz=UTC";

describe("an invalid query", () => {
  const routes = ["/api/usage/series?grain=day", "/api/usage/breakdown?dimension=model"];
  it.each(routes)("%s rejects an unknown time zone", async (route) => {
    expect((await get(`${route}&from=2026-11-01&to=2026-11-03&tz=Mars/Base`)).statusCode).toBe(400);
  });
  it.each(routes)("%s rejects an offset time zone", async (route) => {
    for (const tz of ["%2B03:00", "-05:00", "EST5EDT%20extra", "UTC%2B3"]) {
      expect((await get(`${route}&from=2026-11-01&to=2026-11-03&tz=${tz}`)).statusCode).toBe(400);
    }
  });
  it.each(routes)("%s rejects a from date after the to date", async (route) => {
    expect((await get(`${route}&from=2026-11-04&to=2026-11-03&tz=UTC`)).statusCode).toBe(400);
  });
  it.each(routes)(
    "%s rejects a malformed date, an unknown field and an unknown Project",
    async (route) => {
      expect((await get(`${route}&from=2026-13-01&to=2026-11-03&tz=UTC`)).statusCode).toBe(400);
      expect((await get(`${route}&${range}&extra=1`)).statusCode).toBe(400);
      expect((await get(`${route}&${range}&project=000000000000`)).statusCode).toBe(400);
    },
  );
  it("rejects a day range of more than 3,700 buckets and accepts exactly 3,700", async () => {
    const day = (offset: number) =>
      new Date(Date.UTC(2016, 0, 1 + offset)).toISOString().slice(0, 10);
    const url = (last: number) =>
      `/api/usage/series?grain=day&tz=UTC&from=${day(0)}&to=${day(last)}`;
    expect((await get(url(3700))).statusCode).toBe(400);
    expect((await get(url(3699))).statusCode).toBe(200);
  });
  it("rejects a breakdown limit above 500", async () => {
    expect((await get(`/api/usage/breakdown?dimension=model&${range}&limit=501`)).statusCode).toBe(
      400,
    );
  });
});

describe("GET /api/usage/series", () => {
  it("groups by day in the time zone and lists empty buckets with zeros", async () => {
    await seed([
      {
        key: A,
        time: "2026-11-01T23:30:00.000Z",
        input: 10,
        output: 20,
        write5m: 1,
        write1h: 2,
        read: 5,
      },
      { key: A, time: "2026-11-03T10:00:00.000Z", input: 1, output: 1 },
    ]);
    const utc = await get(`/api/usage/series?grain=day&${range}`);
    expect(utc.json()).toMatchObject({
      buckets: [
        {
          start: "2026-11-01",
          inputTokens: 10,
          outputTokens: 20,
          cacheWriteTokens: 3,
          cacheReadTokens: 5,
          turns: 1,
        },
        {
          start: "2026-11-02",
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          turns: 0,
        },
        { start: "2026-11-03", inputTokens: 1, outputTokens: 1, turns: 1 },
      ],
    });
    const auckland = await get(
      `/api/usage/series?grain=day&from=2026-11-01&to=2026-11-03&tz=Pacific/Auckland`,
    );
    const starts = auckland.json<{ buckets: { start: string; turns: number }[] }>().buckets;
    expect(starts.map((b) => [b.start, b.turns])).toEqual([
      ["2026-11-01", 0],
      ["2026-11-02", 1],
      ["2026-11-03", 1],
    ]);
  });

  it("groups by week from Monday and by month", async () => {
    await seed([
      { key: A, time: "2026-11-01T10:00:00.000Z" }, // Sunday
      { key: A, time: "2026-11-02T10:00:00.000Z" }, // Monday
      { key: A, time: "2026-12-05T10:00:00.000Z" },
    ]);
    const week = await get("/api/usage/series?grain=week&from=2026-11-01&to=2026-11-09&tz=UTC");
    expect(
      week
        .json<{ buckets: { start: string; turns: number }[] }>()
        .buckets.map((b) => [b.start, b.turns]),
    ).toEqual([
      ["2026-10-26", 1],
      ["2026-11-02", 1],
      ["2026-11-09", 0],
    ]);
    const month = await get("/api/usage/series?grain=month&from=2026-11-01&to=2026-12-31&tz=UTC");
    expect(
      month
        .json<{ buckets: { start: string; turns: number }[] }>()
        .buckets.map((b) => [b.start, b.turns]),
    ).toEqual([
      ["2026-11-01", 2],
      ["2026-12-01", 1],
    ]);
  });

  it("filters by Project", async () => {
    await seed([
      { key: A, time: "2026-11-01T10:00:00.000Z" },
      { key: B, time: "2026-11-01T11:00:00.000Z" },
    ]);
    const response = await get(`/api/usage/series?grain=day&${range}&project=${projectId(B)}`);
    expect(response.json<{ buckets: { turns: number }[] }>().buckets[0]?.turns).toBe(1);
  });
});

describe("GET /api/usage/breakdown", () => {
  it("groups models, marks fast mode, sorts by total tokens and adds totals", async () => {
    await seed([
      { key: A, time: "2026-11-01T10:00:00.000Z", model: "m-small", input: 1, output: 1 },
      {
        key: A,
        time: "2026-11-01T11:00:00.000Z",
        model: "m-big",
        speed: "fast",
        input: 100,
        output: 50,
        read: 10,
      },
      {
        key: B,
        time: "2026-11-02T11:00:00.000Z",
        model: "m-big",
        speed: "fast",
        input: 100,
        output: 50,
      },
      { key: B, time: "2026-11-09T11:00:00.000Z", model: "m-out", input: 999 },
    ]);
    const response = await get(`/api/usage/breakdown?dimension=model&${range}`);
    expect(response.json()).toEqual({
      rows: [
        {
          key: "m-big (fast)",
          label: "m-big (fast)",
          inputTokens: 200,
          outputTokens: 100,
          cacheWriteTokens: 0,
          cacheReadTokens: 10,
          turns: 2,
        },
        {
          key: "m-small",
          label: "m-small",
          inputTokens: 1,
          outputTokens: 1,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          turns: 1,
        },
      ],
      totals: {
        inputTokens: 201,
        outputTokens: 101,
        cacheWriteTokens: 0,
        cacheReadTokens: 10,
        turns: 3,
      },
      rowCount: 2,
    });
  });

  it("labels Project rows and session rows and gives session times", async () => {
    await seed([
      { key: A, time: "2026-11-01T10:00:00.000Z", session: "sa" },
      { key: A, time: "2026-11-02T10:00:00.000Z", session: "sa" },
      { key: B, time: "2026-11-02T10:00:00.000Z", session: "sb", input: 50 },
    ]);
    const projects = await get(`/api/usage/breakdown?dimension=project&${range}`);
    expect(
      projects
        .json<{ rows: { key: string; label: string; turns: number }[] }>()
        .rows.map((r) => [r.key, r.label, r.turns]),
    ).toEqual([
      [projectId(B), "tool", 1],
      [projectId(A), "app", 2],
    ]);
    const sessions = await get(`/api/usage/breakdown?dimension=session&${range}`);
    expect(sessions.json<{ rows: unknown[] }>().rows[1]).toMatchObject({
      key: "sa",
      label: "app",
      firstTurnAt: "2026-11-01T10:00:00.000Z",
      lastTurnAt: "2026-11-02T10:00:00.000Z",
    });
  });

  it("groups by Agent type and branch, and applies the limit and the Project filter", async () => {
    await seed([
      { key: A, time: "2026-11-01T10:00:00.000Z", agentType: "main", branch: "x", input: 5 },
      { key: A, time: "2026-11-01T10:00:00.000Z", agentType: "reviewer", branch: null, input: 3 },
      { key: B, time: "2026-11-01T10:00:00.000Z", agentType: "main", branch: "x", input: 1 },
    ]);
    const agents = await get(`/api/usage/breakdown?dimension=agentType&${range}`);
    expect(agents.json<{ rows: { key: string }[] }>().rows.map((r) => r.key)).toEqual([
      "main",
      "reviewer",
    ]);
    const limited = await get(`/api/usage/breakdown?dimension=branch&${range}&limit=1`);
    expect(limited.json()).toMatchObject({
      rowCount: 2,
      rows: [{ key: "x", turns: 2 }],
      totals: { turns: 3 },
    });
    const filtered = await get(
      `/api/usage/breakdown?dimension=agentType&${range}&project=${projectId(B)}`,
    );
    expect(filtered.json<{ rows: unknown[] }>().rows).toHaveLength(1);
  });

  it("returns no row for an empty range and refuses an unknown dimension", async () => {
    expect((await get(`/api/usage/breakdown?dimension=model&${range}`)).json()).toMatchObject({
      rows: [],
      rowCount: 0,
    });
    expect((await get(`/api/usage/breakdown?dimension=color&${range}`)).statusCode).toBe(400);
  });
});
