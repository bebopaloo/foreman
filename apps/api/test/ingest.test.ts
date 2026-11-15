import path from "node:path";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestTranscripts, withRefreshLock } from "../src/usage/ingest.ts";
import { openTestDatabase } from "./database.ts";
import {
  assistantLine,
  makeConfigFolder,
  recordingLog,
  writeArchived,
  writeMeta,
  toolResultLine,
  userLine,
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
  await database.db.execute(
    sql`truncate table turns, agents, projects, refresh_runs, file_cursors, user_messages`,
  );
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

  it("stores the times of the 3 real user messages, and none from a sub-agent", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "-synthetic-a-app/session-1.jsonl", [
      userLine("u1", { time: "2026-11-01T10:00:00.000Z" }),
      assistantLine("m1", { time: "2026-11-01T10:00:30.000Z" }),
      toolResultLine("r1", { time: "2026-11-01T10:01:00.000Z" }),
      userLine("u2", { time: "2026-11-01T10:02:00.000Z" }),
      toolResultLine("r2", { time: "2026-11-01T10:03:00.000Z" }),
      userLine("u3", { time: "2026-11-01T10:04:00.000Z" }),
    ]);
    await writeTranscript(folder.claudeDir, "-synthetic-a-app/session-1/subagents/agent-a1.jsonl", [
      userLine("task", { time: "2026-11-01T10:00:10.000Z" }),
      assistantLine("sub1"),
    ]);

    await refresh(folder);

    const rows = await database.db
      .select()
      .from(schema.userMessages)
      .orderBy(schema.userMessages.time);
    expect(rows.map((row) => row.recordId)).toEqual(["u1", "u2", "u3"]);
    expect(rows[0]).toMatchObject({
      sessionId: "session-1",
      time: new Date("2026-11-01T10:00:00.000Z"),
      projectKey: "/synthetic/a/app",
      branch: "feature-x",
    });
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC");
  });

  it("stores a user message once when a later refresh reads the file again", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [userLine("u1")]);
    await refresh(folder);
    await database.db.execute(sql`truncate table file_cursors`);

    await refresh(folder);

    expect(await database.db.select().from(schema.userMessages)).toHaveLength(1);
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

  it("gives sub-agent turns the type of the meta file and records the start call", async () => {
    const folder = await makeConfigFolder();
    const dir = "p/session-1/subagents";
    await writeTranscript(folder.claudeDir, `${dir}/agent-a1.jsonl`, [assistantLine("m1")]);
    await writeMeta(folder.claudeDir, `${dir}/agent-a1.meta.json`, {
      agentType: "software-developer",
      toolUseId: "toolu_1",
      description: "SYNTHETIC-TASK-TEXT",
    });
    await writeTranscript(folder.claudeDir, `${dir}/agent-a2.jsonl`, [assistantLine("m2")]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => [row.turnKey, row.agentId, row.agentType])).toEqual([
      ["m1", "a1", "software-developer"],
      ["m2", "a2", "sub-agent (unknown)"],
    ]);
    const agents = await database.db.select().from(schema.agents).orderBy(schema.agents.agentId);
    expect(agents).toEqual([
      {
        agentId: "a1",
        sessionId: "session-1",
        agentType: "software-developer",
        startToolCallId: "toolu_1",
      },
      {
        agentId: "a2",
        sessionId: "session-1",
        agentType: "sub-agent (unknown)",
        startToolCallId: null,
      },
    ]);
    expect(JSON.stringify(agents)).not.toContain("SYNTHETIC");
  });

  it("updates stored sub-agent turns when the meta file appears after the first refresh", async () => {
    const folder = await makeConfigFolder();
    const dir = "p/session-1/subagents";
    await writeTranscript(folder.claudeDir, `${dir}/agent-a1.jsonl`, [assistantLine("m1")]);
    await refresh(folder);

    await writeMeta(folder.claudeDir, `${dir}/agent-a1.meta.json`, {
      agentType: "software-developer",
      toolUseId: "toolu_1",
    });
    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows.map((row) => [row.turnKey, row.agentType])).toEqual([["m1", "software-developer"]]);
    const agents = await database.db.select().from(schema.agents);
    expect(agents.map((row) => [row.agentId, row.agentType, row.startToolCallId])).toEqual([
      ["a1", "software-developer", "toolu_1"],
    ]);
  });

  it("sets the agent ID of a stored sub-agent turn that has none", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1/subagents/agent-a1.jsonl", [
      assistantLine("m1"),
    ]);
    await refresh(folder);
    await database.db.execute(sql`update turns set agent_id = null`);
    await database.db.execute(sql`truncate table file_cursors`);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows[0]?.agentId).toBe("a1");
  });

  it("keeps the agents rows after a replaceAll refresh", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1/subagents/agent-a1.jsonl", [
      assistantLine("m1"),
    ]);
    await refresh(folder);
    await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recordingLog().log,
      replaceAll: true,
    });

    const agents = await database.db.select().from(schema.agents);
    expect(agents.map((row) => row.agentId)).toEqual(["a1"]);
  });

  it("reads the meta file of a sub-agent from the archive", async () => {
    const folder = await makeConfigFolder();
    await writeArchived(folder.dataDir, "p/session-1/subagents/agent-a1.jsonl", [
      assistantLine("m1"),
    ]);
    await writeArchived(folder.dataDir, "p/session-1/subagents/agent-a1.meta.json", [
      JSON.stringify({ agentType: "reviewer" }),
    ]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows[0]?.agentType).toBe("reviewer");
  });

  it("keeps the known agent type when a later copy of the agent has no meta file", async () => {
    const folder = await makeConfigFolder();
    const dir = "p/session-1/subagents";
    await writeTranscript(folder.claudeDir, `${dir}/agent-a1.jsonl`, [assistantLine("m1")]);
    await writeMeta(folder.claudeDir, `${dir}/agent-a1.meta.json`, {
      agentType: "software-developer",
      toolUseId: "toolu_1",
    });
    await writeArchived(folder.dataDir, `${dir}/agent-a1.jsonl`, [assistantLine("m2")]);

    await refresh(folder);

    const agents = await database.db.select().from(schema.agents);
    expect(agents).toEqual([
      {
        agentId: "a1",
        sessionId: "session-1",
        agentType: "software-developer",
        startToolCallId: "toolu_1",
      },
    ]);
    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => [row.turnKey, row.agentType])).toEqual([
      ["m1", "software-developer"],
      ["m2", "software-developer"],
    ]);
  });

  it("refreshes more sub-agents than one query can hold parameters for", async () => {
    const folder = await makeConfigFolder();
    const count = 17_000;
    const ids = Array.from({ length: count }, (_, index) => `a${String(index)}`);
    const directory = path.join(folder.claudeDir, "projects", "p", "session-1", "subagents");
    await mkdir(directory, { recursive: true });
    for (let start = 0; start < count; start += 500) {
      await Promise.all(
        ids
          .slice(start, start + 500)
          .map((id) =>
            writeFile(path.join(directory, `agent-${id}.jsonl`), `${assistantLine(`m-${id}`)}\n`),
          ),
      );
    }

    const first = await refresh(folder);
    await writeMeta(folder.claudeDir, "p/session-1/subagents/agent-a16999.meta.json", {
      agentType: "reviewer",
    });
    await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recordingLog().log,
      replaceAll: true,
    });

    expect(first.result.files).toBe(count);
    const agents = await database.db.select({ id: schema.agents.agentId }).from(schema.agents);
    expect(agents).toHaveLength(count);
    const reviewed = await database.db
      .select({ key: schema.turns.turnKey })
      .from(schema.turns)
      .where(sql`${schema.turns.agentType} = 'reviewer'`);
    expect(reviewed).toEqual([{ key: "m-a16999" }]);
    const runs = await database.db
      .select({ state: schema.refreshRuns.state })
      .from(schema.refreshRuns);
    expect(runs.map((run) => run.state)).toEqual(["idle", "idle"]);
  }, 60_000);

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

describe("ingestTranscripts cursors", () => {
  it("reads only the 2 new lines and logs the path and the count", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
      assistantLine("m2"),
      assistantLine("m3"),
    ]);
    await refresh(folder);
    await appendFile(file, [assistantLine("m4"), assistantLine("m5")].join("\n") + "\n");

    const { result, entries } = await refresh(folder);

    expect(result).toMatchObject({ files: 1, turns: 2 });
    expect(entries.map((entry) => entry.message)).toContain(`read 2 new lines in ${file}`);
    expect(JSON.stringify(entries)).not.toContain("SYNTHETIC");
    expect(await database.db.select().from(schema.turns)).toHaveLength(5);
  });

  it("reads nothing from a file that did not change", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await refresh(folder);

    const { result } = await refresh(folder);

    expect(result).toMatchObject({ files: 1, turns: 0 });
  });

  it("reads the full file again when bytes that it already read changed", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1", { input: 5 }),
      assistantLine("m2"),
    ]);
    await refresh(folder);
    await writeFile(
      file,
      [assistantLine("m1", { input: 9 }), assistantLine("m2"), assistantLine("m3")].join("\n") +
        "\n",
    );

    const { result, entries } = await refresh(folder);

    expect(result.turns).toBe(3);
    expect(entries.map((entry) => entry.message)).toContain(`read 3 new lines in ${file}`);
    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => row.turnKey)).toEqual(["m1", "m2", "m3"]);
    expect(rows[0]?.inputTokens).toBe(9);
  });

  it("reads only the new lines of a file over 4 KiB that grows", async () => {
    const folder = await makeConfigFolder();
    const lines = Array.from({ length: 30 }, (_, index) => assistantLine("m" + String(index)));
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", lines);
    expect((await readFile(file)).length).toBeGreaterThan(8192);
    await refresh(folder);
    await appendFile(file, [assistantLine("m30"), assistantLine("m31")].join("\n") + "\n");

    const { result, entries } = await refresh(folder);

    expect(result.turns).toBe(2);
    expect(entries.map((entry) => entry.message)).toContain(`read 2 new lines in ${file}`);
    expect(await database.db.select().from(schema.turns)).toHaveLength(32);
  });

  it("reads the full file again when only the 4 KiB before the offset changed", async () => {
    const folder = await makeConfigFolder();
    const lines = Array.from({ length: 30 }, (_, index) => assistantLine("m" + String(index)));
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", lines);
    expect((await readFile(file)).length).toBeGreaterThan(8192);
    await refresh(folder);
    const changed = [...lines];
    changed[25] = assistantLine("m25", { input: 9 });
    await writeFile(file, changed.join("\n") + "\n");

    const { result } = await refresh(folder);

    expect(result.turns).toBe(30);
    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows).toHaveLength(30);
    expect(rows.find((row) => row.turnKey === "m25")?.inputTokens).toBe(9);
  });

  it("reads the full file again when it is smaller than the offset", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
      assistantLine("m2"),
    ]);
    await refresh(folder);
    await writeFile(file, assistantLine("m3") + "\n");

    const { result } = await refresh(folder);

    expect(result.turns).toBe(1);
    expect(await database.db.select().from(schema.turns)).toHaveLength(3);
  });

  it("reads a half-written last line in the next refresh, when it is complete", async () => {
    const folder = await makeConfigFolder();
    const second = assistantLine("m2");
    const file = await writeTranscript(
      folder.claudeDir,
      "p/session-1.jsonl",
      [assistantLine("m1"), second.slice(0, 40)],
      { endWithNewline: false },
    );
    await refresh(folder);
    expect((await database.db.select().from(schema.turns)).map((row) => row.turnKey)).toEqual([
      "m1",
    ]);
    await appendFile(file, second.slice(40) + "\n");

    const { result } = await refresh(folder);

    expect(result.turns).toBe(1);
    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => row.turnKey)).toEqual(["m1", "m2"]);
  });

  it("keeps the cursor of a file that it cannot read, and reads it later", async () => {
    const folder = await makeConfigFolder();
    const file = await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [
      assistantLine("m1"),
    ]);
    await refresh(folder);
    await appendFile(file, assistantLine("m2") + "\n");
    await chmod(file, 0o000);
    try {
      const { result } = await refresh(folder);
      expect(result.unreadableFiles).toBe(1);
    } finally {
      await chmod(file, 0o600);
    }

    const { result } = await refresh(folder);

    expect(result.turns).toBe(1);
    expect(await database.db.select().from(schema.turns)).toHaveLength(2);
  });

  it("ignores the cursors when it replaces all turns", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await refresh(folder);
    await database.db.execute(sql`truncate table turns`);

    const result = await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recordingLog().log,
      replaceAll: true,
    });

    expect(result.turns).toBe(1);
    expect(await database.db.select().from(schema.turns)).toHaveLength(1);
  });
});

describe("ingestTranscripts Projects", () => {
  it("gives sessions in a worktree and a subfolder the Project of the main checkout", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/s1.jsonl", [
      assistantLine("m1", { cwd: "/synthetic/a/app", session: "s1" }),
    ]);
    await writeTranscript(folder.claudeDir, "p/s2.jsonl", [
      assistantLine("m2", { cwd: "/synthetic/a/app/.claude/worktrees/x", session: "s2" }),
    ]);
    await writeTranscript(folder.claudeDir, "p/s3.jsonl", [
      assistantLine("m3", { cwd: "/synthetic/a/app/packages/web", session: "s3" }),
    ]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.projectKey))).toEqual(new Set(["/synthetic/a/app"]));
  });

  it("flags a session outside a repo with its folder path as the key", async () => {
    const folder = await makeConfigFolder();
    await mkdir(folder.claudeDir, { recursive: true });
    await writeTranscript(folder.claudeDir, "p/s1.jsonl", [
      assistantLine("m1", { cwd: folder.claudeDir }),
    ]);

    await refresh(folder);

    const rows = await database.db.select().from(schema.turns);
    expect(rows[0]?.projectKey).toBe(folder.claudeDir);
    const projects = await database.db.select().from(schema.projects);
    expect(projects).toEqual([{ projectKey: folder.claudeDir, noRepo: true }]);
  });
});

describe("ingestTranscripts progress", () => {
  it("reports the files read and the files found", async () => {
    const folder = await makeConfigFolder();
    for (const name of ["a", "b", "c"]) {
      await writeTranscript(folder.claudeDir, `p/${name}.jsonl`, [assistantLine(`m-${name}`)]);
    }
    const seen: { filesRead: number; filesTotal: number }[] = [];

    await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recordingLog().log,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toEqual([
      { filesRead: 0, filesTotal: 3 },
      { filesRead: 1, filesTotal: 3 },
      { filesRead: 2, filesTotal: 3 },
      { filesRead: 3, filesTotal: 3 },
    ]);
  });
});

describe("withRefreshLock", () => {
  it("runs one caller at a time and tells the second caller that a refresh runs", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withRefreshLock(database.db, async () => {
      entered();
      await held;
      return "first";
    });
    await inside;

    const second = await withRefreshLock(database.db, () => Promise.resolve("second"));
    release();

    expect(second).toEqual({ ran: false });
    expect(await first).toEqual({ ran: true, value: "first" });
    expect(await withRefreshLock(database.db, () => Promise.resolve("third"))).toEqual({
      ran: true,
      value: "third",
    });
  });
});

describe("ingestTranscripts archive", () => {
  it("counts each turn once when a session is in the live folder and in the archive", async () => {
    const folder = await makeConfigFolder();
    const lines = [assistantLine("m1"), assistantLine("m2")];
    await writeTranscript(folder.claudeDir, "p/session-1.jsonl", lines);
    await writeArchived(folder.dataDir, "p/session-1.jsonl", [...lines, assistantLine("m3")]);

    const { result } = await refresh(folder);
    await refresh(folder);

    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => row.turnKey)).toEqual(["m1", "m2", "m3"]);
    expect(result.turns).toBe(3);
  });

  it("indexes a session that is only in the archive, with its agent type", async () => {
    const folder = await makeConfigFolder();
    await writeArchived(folder.dataDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await writeArchived(folder.dataDir, "p/session-1/subagents/agent-a1.jsonl", [
      assistantLine("m2"),
    ]);
    await writeArchived(folder.dataDir, "p/session-1/subagents/agent-a1.meta.json", [
      JSON.stringify({ agentType: "x" }),
    ]);

    const { result } = await refresh(folder);

    const rows = await database.db.select().from(schema.turns).orderBy(schema.turns.turnKey);
    expect(rows.map((row) => [row.turnKey, row.agentType])).toEqual([
      ["m1", "main"],
      ["m2", "x"],
    ]);
    expect(result).toMatchObject({ files: 2, unreadableFiles: 0 });
  });

  it("reads an archive file again only when its size or time changed", async () => {
    const folder = await makeConfigFolder();
    await writeArchived(folder.dataDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await refresh(folder);
    await database.db.delete(schema.turns);

    await refresh(folder);
    expect(await database.db.select().from(schema.turns)).toHaveLength(0);

    await writeArchived(folder.dataDir, "p/session-1.jsonl", [
      assistantLine("m1"),
      assistantLine("m2"),
    ]);
    await refresh(folder);
    expect(await database.db.select().from(schema.turns)).toHaveLength(2);
  });

  it("skips an archive file that is not valid gzip, logs its path and reads the others", async () => {
    const folder = await makeConfigFolder();
    const bad = await writeArchived(folder.dataDir, "p/session-1.jsonl", [assistantLine("m1")]);
    await writeFile(bad, "this is not gzip");
    await writeArchived(folder.dataDir, "p/session-2.jsonl", [assistantLine("m2")]);

    const { result, entries } = await refresh(folder);

    expect(result).toMatchObject({ files: 1, turns: 1, unreadableFiles: 1 });
    expect(entries.map((entry) => entry.message)).toContain(`unreadable file: ${bad}`);
  });

  it("keeps the archive turns of a deleted transcript when pnpm reindex runs", async () => {
    const folder = await makeConfigFolder();
    await writeArchived(folder.dataDir, "p/session-1.jsonl", [assistantLine("m1")]);
    const recorder = recordingLog();

    await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recorder.log,
      replaceAll: true,
    });

    expect((await database.db.select().from(schema.turns)).map((row) => row.turnKey)).toEqual([
      "m1",
    ]);
  });
});
