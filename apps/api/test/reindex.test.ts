import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runReindex } from "../src/reindex.ts";
import { withRefreshLock } from "../src/usage/ingest.ts";
import { openTestDatabase } from "./database.ts";
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
  await database.db.execute(sql`truncate table turns, refresh_runs`);
});

describe("runReindex", () => {
  it("deletes the index data, reads the sources again and reports the counts", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
      assistantLine("m2"),
    ]);
    await database.db.insert(schema.turns).values({
      turnKey: "stale",
      sessionId: "gone",
      time: new Date("2026-01-01T00:00:00Z"),
      model: "claude-synthetic-1",
      inputTokens: 1,
      outputTokens: 1,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      webSearchCount: 0,
      projectKey: "/synthetic/a/app",
      agentType: "main",
    });
    const recorder = recordingLog();

    const summary = await runReindex({ db: database.db, ...folder, log: recorder.log });

    const keys = (await database.db.select().from(schema.turns)).map((row) => row.turnKey).sort();
    expect(keys).toEqual(["m1", "m2"]);
    expect(summary).toBe("Reindex done: 1 file, 2 turns.");
  });

  it("keeps the old index data when the write fails", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 3_000_000_000 }),
    ]);
    await database.db.insert(schema.turns).values({
      turnKey: "old",
      sessionId: "s",
      time: new Date("2026-01-01T00:00:00Z"),
      model: "claude-synthetic-1",
      inputTokens: 1,
      outputTokens: 1,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      webSearchCount: 0,
      projectKey: "/synthetic/a/app",
      agentType: "main",
    });

    await expect(
      runReindex({ db: database.db, ...folder, log: recordingLog().log }),
    ).rejects.toThrow();

    const keys = (await database.db.select().from(schema.turns)).map((row) => row.turnKey);
    expect(keys).toEqual(["old"]);
  });

  it("stops with a message and keeps the data while a refresh runs", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [assistantLine("m1")]);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const refresh = withRefreshLock(database.db, async () => {
      entered();
      await held;
    });
    await inside;

    try {
      await expect(
        runReindex({ db: database.db, ...folder, log: recordingLog().log }),
      ).rejects.toThrow("A refresh is running.");
    } finally {
      release();
      await refresh;
    }

    expect(await database.db.select().from(schema.turns)).toEqual([]);
  });
});
