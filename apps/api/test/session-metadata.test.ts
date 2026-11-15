import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { ingestTranscripts } from "../src/usage/ingest.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry } from "./repo-list-fixtures.ts";
import {
  assistantLine,
  makeConfigFolder,
  recordingLog,
  toolResultLine,
  userLine,
  writeMeta,
  writeTranscript,
} from "./usage-fixtures.ts";

const CANARY = "CANARY-7f3e";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table turns, agents, projects, refresh_runs, file_cursors, user_messages, skill_calls, agent_starts`,
  );
});

/** The fixture lines hold fake text. The canary replaces each of those texts. */
function canary(line: string): string {
  return line.replace(/SYNTHETIC-[A-Z-]+/g, CANARY);
}

function thinkingLine(messageId: string, time: string): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "session-1",
    timestamp: time,
    cwd: "/synthetic/acme/app.worktrees/212-add-refunds",
    gitBranch: "HEAD",
    message: {
      id: messageId,
      model: "claude-synthetic-1",
      content: [{ type: "thinking", thinking: CANARY, signature: CANARY }],
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
}

describe("metadata only", () => {
  it("never puts the text of a transcript in the Usage index or in a session response", async () => {
    const folder = await makeConfigFolder();
    const cwd = "/synthetic/acme/app.worktrees/212-add-refunds";
    await writeTranscript(
      folder.claudeDir,
      "-synthetic-acme-app/session-1.jsonl",
      [
        userLine("u1", { time: "2026-11-14T09:00:00.000Z", cwd }),
        assistantLine("m1", { time: "2026-11-14T09:01:00.000Z", cwd }),
        thinkingLine("m2", "2026-11-14T09:02:00.000Z"),
        toolResultLine("r1", { time: "2026-11-14T09:03:00.000Z", cwd }),
      ].map(canary),
    );
    const sub = "-synthetic-acme-app/session-1/subagents";
    await writeTranscript(folder.claudeDir, `${sub}/agent-a1.jsonl`, [
      canary(assistantLine("s1", { time: "2026-11-14T09:05:00.000Z", cwd })),
    ]);
    await writeMeta(folder.claudeDir, `${sub}/agent-a1.meta.json`, {
      agentType: "software-developer",
      toolUseId: "toolu_1",
      description: CANARY,
    });
    await ingestTranscripts({ db: database.db, ...folder, log: recordingLog().log });

    const tables = [
      schema.turns,
      schema.agents,
      schema.projects,
      schema.userMessages,
      schema.skillCalls,
      schema.agentStarts,
      schema.fileCursors,
    ];
    for (const table of tables) {
      expect(JSON.stringify(await database.db.select().from(table))).not.toContain(CANARY);
    }

    const claudeDir = path.join(folder.claudeDir, "config");
    await mkdir(path.join(claudeDir, "factory"), { recursive: true });
    await writeFile(
      path.join(claudeDir, "factory", "repos.json"),
      JSON.stringify({ repos: [entry("acme/app", "acme")] }),
    );
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
    });
    const list = await app.inject({ method: "GET", url: "/api/sessions?day=2026-11-14&tz=UTC" });
    const one = await app.inject({
      method: "GET",
      url: "/api/sessions/session-1?day=2026-11-14&tz=UTC",
    });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(one.statusCode).toBe(200);
    expect(one.json<{ spans: unknown[] }>().spans.length).toBeGreaterThan(0);
    expect(list.body).not.toContain(CANARY);
    expect(one.body).not.toContain(CANARY);
    // No working folder path either.
    expect(one.body).not.toContain("/synthetic");
  });
});
