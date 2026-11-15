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
    sql`truncate table turns, projects, refresh_runs, skill_calls, limit_readings`,
  );
});

const ACME = "/synthetic/acme/app";
const OWN = "/synthetic/bebopaloo/tool";
const OTHER = "/synthetic/elsewhere/thing";

let counter = 0;
async function seed(keys: string[]) {
  for (const key of keys) {
    counter += 1;
    await database.db
      .insert(schema.projects)
      .values({ projectKey: key, noRepo: false })
      .onConflictDoNothing();
    await database.db.insert(schema.turns).values({
      turnKey: `t${String(counter)}`,
      sessionId: `s${String(counter)}`,
      time: new Date("2026-11-03T10:00:00.000Z"),
      model: "claude-synthetic-1",
      speed: null,
      serviceTier: null,
      inputTokens: 10,
      outputTokens: 5,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      webSearchCount: 0,
      projectKey: key,
      branch: "main",
      agentType: "main",
      skillName: null,
      skillBasis: null,
    });
  }
}

async function get(url: string, repoList?: unknown) {
  const claudeDir = await makeClaudeDir(
    repoList ?? {
      repos: [entry("acme/app", "acme"), entry("bebopaloo/tool", "bebopaloo")],
    },
  );
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir };
  const app = await buildApp({ config, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

const RANGE = "from=2026-11-01&to=2026-11-30&tz=UTC";

interface Row {
  key: string;
  inputTokens: number;
}

describe("usage routes in a client scope", () => {
  it("breakdown shows only the turns of the client's Project", async () => {
    await seed([ACME, ACME, OTHER]);

    const scoped = await get(`/api/usage/breakdown?${RANGE}&dimension=project&client=acme`);
    expect(scoped.statusCode).toBe(200);
    const body = scoped.json<{ rows: Row[]; totals: { turns: number }; rowCount: number }>();
    expect(body.rows.map((row) => row.key)).toEqual([projectId(ACME)]);
    expect(body.totals.turns).toBe(2);
    expect(body.rowCount).toBe(1);

    const all = await get(`/api/usage/breakdown?${RANGE}&dimension=project`);
    expect(all.json<{ rows: Row[] }>().rows).toHaveLength(2);
  });

  it("breakdown by skill counts only the skill calls of the client's Projects", async () => {
    await seed([ACME, OTHER]);
    for (const [index, key] of [ACME, OTHER].entries()) {
      await database.db.insert(schema.skillCalls).values({
        callId: `c${String(index)}`,
        sessionId: `s${String(index)}`,
        projectKey: key,
        time: new Date("2026-11-03T10:00:00.000Z"),
        skillName: "synthetic-skill",
      });
    }
    const scoped = await get(`/api/usage/breakdown?${RANGE}&dimension=skill&client=acme`);
    expect(scoped.statusCode).toBe(200);
    const rows = scoped.json<{ rows: { key: string; calls: number }[] }>().rows;
    expect(rows.find((row) => row.key === "synthetic-skill")?.calls).toBe(1);
    const unscoped = await get(`/api/usage/breakdown?${RANGE}&dimension=skill`);
    const allRows = unscoped.json<{ rows: { key: string; calls: number }[] }>().rows;
    expect(allRows.find((row) => row.key === "synthetic-skill")?.calls).toBe(2);
  });

  it("series shows only the turns of the client's Project", async () => {
    await seed([ACME, OTHER, OTHER]);
    const scoped = await get(`/api/usage/series?${RANGE}&grain=month&client=acme`);
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json<{ buckets: { turns: number }[] }>().buckets[0]?.turns).toBe(1);
    const all = await get(`/api/usage/series?${RANGE}&grain=month`);
    expect(all.json<{ buckets: { turns: number }[] }>().buckets[0]?.turns).toBe(3);
  });

  it("projects lists only the client's Projects", async () => {
    await seed([ACME, OWN, OTHER]);
    const scoped = await get("/api/usage/projects?client=acme");
    expect(scoped.json<{ projects: { id: string }[] }>().projects.map((p) => p.id)).toEqual([
      projectId(ACME),
    ]);
    const all = await get("/api/usage/projects");
    expect(all.json<{ projects: unknown[] }>().projects).toHaveLength(3);
  });

  it("returns the client of each Project in the project breakdown and in the projects list", async () => {
    await seed([ACME, OTHER]);
    const breakdown = await get(`/api/usage/breakdown?${RANGE}&dimension=project`);
    const rows = breakdown.json<{ rows: { key: string; client: string | null }[] }>().rows;
    expect(rows.find((row) => row.key === projectId(ACME))?.client).toBe("acme");
    expect(rows.find((row) => row.key === projectId(OTHER))?.client).toBeNull();

    const projects = await get("/api/usage/projects");
    const list = projects.json<{ projects: { id: string; client: string | null }[] }>().projects;
    expect(list.find((p) => p.id === projectId(ACME))?.client).toBe("acme");
    expect(list.find((p) => p.id === projectId(OTHER))?.client).toBeNull();
  });

  it("returns a null client when the repo list is missing", async () => {
    await seed([ACME]);
    const claudeDir = await makeClaudeDir();
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
    });
    const response = await app.inject({ method: "GET", url: "/api/usage/projects" });
    await app.close();
    expect(
      response.json<{ projects: { client: string | null }[] }>().projects[0]?.client,
    ).toBeNull();
  });

  it("does not add a client to the rows of another dimension", async () => {
    await seed([ACME]);
    const response = await get(`/api/usage/breakdown?${RANGE}&dimension=model`);
    expect(response.json<{ rows: object[] }>().rows[0]).not.toHaveProperty("client");
  });

  it("returns an empty result for a client with no turns", async () => {
    await seed([OTHER]);
    const scoped = await get("/api/usage/projects?client=acme");
    expect(scoped.json()).toEqual({ projects: [] });
    const series = await get(`/api/usage/series?${RANGE}&grain=month&client=acme`);
    expect(series.json<{ buckets: { turns: number }[] }>().buckets[0]?.turns).toBe(0);
  });

  it("rejects a Project of another client with status 400", async () => {
    await seed([ACME, OWN]);
    const project = projectId(OWN);
    for (const url of [
      `/api/usage/breakdown?${RANGE}&dimension=model&client=acme&project=${project}`,
      `/api/usage/series?${RANGE}&grain=day&client=acme&project=${project}`,
    ]) {
      expect((await get(url)).statusCode).toBe(400);
    }
    const own = await get(
      `/api/usage/series?${RANGE}&grain=month&client=acme&project=${projectId(ACME)}`,
    );
    expect(own.statusCode).toBe(200);
  });

  it("rejects an unknown client, a client with a bad shape, and any client with no repo list", async () => {
    await seed([ACME]);
    expect((await get("/api/usage/projects?client=globex")).statusCode).toBe(400);
    expect((await get("/api/usage/projects?client=Not%20Valid")).statusCode).toBe(400);
    expect((await get(`/api/usage/series?${RANGE}&grain=day&client=globex`)).statusCode).toBe(400);
    expect((await get("/api/usage/projects?client=acme", "{")).statusCode).toBe(400);
  });

  it("does not match a Project whose path only starts like a repo path", async () => {
    await seed(["/synthetic/acme/app-extra"]);
    const scoped = await get("/api/usage/projects?client=acme");
    expect(scoped.json()).toEqual({ projects: [] });
  });
});

describe("GET /api/usage/limits", () => {
  it("rejects a client value with status 400", async () => {
    const response = await get(`/api/usage/limits?${RANGE}&client=acme`);
    expect(response.statusCode).toBe(400);
    expect((await get(`/api/usage/limits?${RANGE}`)).statusCode).toBe(200);
  });
});
