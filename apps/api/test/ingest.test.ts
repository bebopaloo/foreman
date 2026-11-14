import { chmod } from "node:fs/promises";
import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestTranscripts } from "../src/usage/ingest.ts";
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

async function refresh(folder: { claudeDir: string; dataDir: string }) {
  const recorder = recordingLog();
  const result = await ingestTranscripts({ db: database.db, ...folder, log: recorder.log });
  return { result, entries: recorder.entries };
}

describe("ingestTranscripts", () => {
  it("indexes the 3 turns of a session, with no text", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "-synthetic-a-app/session-1.jsonl", [
      assistantLine("m1", { time: "2026-11-01T10:00:00.000Z" }),
      assistantLine("m2", { time: "2026-11-01T10:01:00.000Z" }),
      assistantLine("m3", { time: "2026-11-01T10:02:00.000Z" }),
    ]);

    const { result } = await refresh(folder);

    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.time);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      turnKey: "m1",
      sessionId: "session-1",
      time: new Date("2026-11-01T10:00:00.000Z"),
      model: "claude-synthetic-1",
      inputTokens: 1,
      outputTokens: 2,
      projectKey: "/synthetic/a/app",
      branch: "feature-x",
      agentType: "main",
    });
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC");
    expect(result).toMatchObject({ state: "idle", files: 1, turns: 3 });
  });

  it("keeps one turn for a message on 3 lines, with the largest counts", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 5, output: 1 }),
      assistantLine("m1", { input: 5, output: 40 }),
      assistantLine("m1", { input: 7, output: 30 }),
    ]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 7, outputTokens: 40 });
  });

  it("counts a turn once when a second refresh reads the same file", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await refresh(folder);
    await refresh(folder);
    const rows = await database.db.select().from(schema.turns);
    expect(rows).toHaveLength(1);
  });

  it("skips a malformed line and logs the path and the count", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
      "{this is not json SYNTHETIC-BAD-LINE",
      assistantLine("m2"),
    ]);

    const { entries } = await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows).toHaveLength(2);
    expect(entries.map((entry) => entry.message)).toContain(`skipped 1 line in ${file}`);
    expect(JSON.stringify(entries)).not.toContain("SYNTHETIC");
  });

  it("skips a last line with no line end", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(
      folder.claudeDir,
      "p/session-1.jsonl",
      [assistantLine("m1"), assistantLine("m2")],
      { endWithNewline: false },
    );
    await refresh(folder);
    const rows = await database.db.select().from(schema.turns);
    expect(rows.map((row) => row.turnKey)).toEqual(["m1"]);
  });

  it("gives a turn in a sub-agent transcript the type sub-agent (unknown)", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1/subagents/agent-a1.jsonl", [
      assistantLine("m1"),
    ]);
    await refresh(folder);
    const rows = await database.db.select().from(schema.turns);
    expect(rows[0]?.agentType).toBe("sub-agent (unknown)");
  });

  it("ends idle with 0 files and logs each missing source", async () => {
    const folder = await makeConfigFolder();

    const { result, entries } = await refresh(folder);

    expect(result).toMatchObject({ state: "idle", files: 0, turns: 0 });
    const messages = entries.map((entry) => entry.message);
    expect(messages).toContain(`missing source: ${folder.claudeDir}/projects`);
    expect(messages).toContain(`missing source: ${folder.dataDir}/archive`);
    expect(messages).toContain(`missing source: ${folder.dataDir}/limit-readings.jsonl`);
  });

  it("keeps the largest counts when a later refresh reads smaller counts", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 5, output: 40 }),
    ]);
    await refresh(folder);
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 9, output: 10 }),
    ]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 9, outputTokens: 40 });
  });

  it("records a failed run and throws when the write fails", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 3_000_000_000 }),
    ]);

    await expect(refresh(folder)).rejects.toThrow();

    const runs = await database.db.select().from(schema.refreshRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "failed", failureReason: "refresh failed" });
    expect(await database.db.select().from(schema.turns)).toHaveLength(0);
  });

  it("counts an unreadable file and logs its path", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
    ]);
    await writeTranscript(folder.claudeDir, "p/session-2.jsonl", [assistantLine("m2")]);
    await chmod(file, 0o000);

    try {
      const { result, entries } = await refresh(folder);

      expect(result).toMatchObject({ files: 1, turns: 1, unreadableFiles: 1 });
      expect(entries.map((entry) => entry.message)).toContain(`unreadable file: ${file}`);
    } finally {
      await chmod(file, 0o600);
    }
  });
});
