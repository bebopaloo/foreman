import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { ingestTranscripts } from "../src/usage/ingest.ts";
import { projectId } from "../src/usage/projects.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import {
  assistantLine,
  makeConfigFolder,
  recordingLog,
  writeTranscript,
} from "./usage-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table turns, agents, projects, refresh_runs`);
});

async function seed(sessions: { cwd: string; time: string }[]) {
  const folder = await makeConfigFolder();
  for (const [index, session] of sessions.entries()) {
    await writeTranscript(folder.claudeDir, `p/s${String(index)}.jsonl`, [
      assistantLine(`m${String(index)}`, {
        cwd: session.cwd,
        time: session.time,
        session: `s${String(index)}`,
      }),
    ]);
  }
  await ingestTranscripts({ db: database.db, ...folder, log: recordingLog().log });
}

async function get(url: string) {
  const app = await buildApp({ config: testConfig, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

describe("GET /api/usage/projects", () => {
  it("labels two Projects with the same folder name by their parent folder", async () => {
    await seed([
      { cwd: "/synthetic/a/app", time: "2026-11-01T10:00:00.000Z" },
      { cwd: "/synthetic/b/app", time: "2026-11-02T10:00:00.000Z" },
    ]);

    const response = await get("/api/usage/projects");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projects: [
        {
          id: projectId("/synthetic/b/app"),
          label: "app (b)",
          noRepo: false,
          firstTurnAt: "2026-11-02T10:00:00.000Z",
          lastTurnAt: "2026-11-02T10:00:00.000Z",
        },
        {
          id: projectId("/synthetic/a/app"),
          label: "app (a)",
          noRepo: false,
          firstTurnAt: "2026-11-01T10:00:00.000Z",
          lastTurnAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    });
  });

  it("applies the limit and refuses a limit above 1000", async () => {
    await seed([
      { cwd: "/synthetic/a/app", time: "2026-11-01T10:00:00.000Z" },
      { cwd: "/synthetic/b/tool", time: "2026-11-02T10:00:00.000Z" },
    ]);

    const limited = await get("/api/usage/projects?limit=1");
    expect(limited.json<{ projects: unknown[] }>().projects).toHaveLength(1);
    expect((await get("/api/usage/projects?limit=1001")).statusCode).toBe(400);
  });

  it("returns an empty list with no turns and holds no path", async () => {
    const empty = await get("/api/usage/projects");
    expect(empty.json()).toEqual({ projects: [] });
    await seed([{ cwd: "/synthetic/a/app", time: "2026-11-01T10:00:00.000Z" }]);
    expect((await get("/api/usage/projects")).body).not.toContain("/synthetic");
    expect(await database.db.select().from(schema.projects)).toHaveLength(1);
  });
});
