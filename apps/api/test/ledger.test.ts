import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { ingestTranscripts } from "../src/usage/ingest.ts";
import { projectId } from "../src/usage/projects.ts";
import { openTestDatabase, TEST_DATABASE_URL } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  assistantLine,
  makeConfigFolder,
  recordingLog,
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
    sql`truncate table turns, user_messages, agents, projects, refresh_runs, skill_calls`,
  );
});

const ACME = "/synthetic/acme/payments-api";
const GLOBEX = "/synthetic/globex/portal";
const SPIKE = "/synthetic/spike-cli";
const OLD_SITE = "/synthetic/old-site";

let counter = 0;

async function message(projectKey: string, time: string, session = "s1") {
  counter += 1;
  await database.db.insert(schema.userMessages).values({
    recordId: `m${String(counter)}`,
    sessionId: session,
    time: new Date(time),
    projectKey,
  });
}

async function turn(projectKey: string, time: string, tokens: number, agentType = "main") {
  counter += 1;
  await database.db.insert(schema.turns).values({
    turnKey: `t${String(counter)}`,
    sessionId: `ts${String(counter)}`,
    time: new Date(time),
    model: "claude-synthetic-1",
    speed: null,
    serviceTier: null,
    inputTokens: tokens,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearchCount: 0,
    projectKey,
    branch: "main",
    agentType,
    skillName: null,
    skillBasis: null,
  });
}

const NOW = () => new Date("2026-11-15T12:00:00.000Z");

const DEFAULT_LIST = {
  repos: [
    entry("acme/payments-api", "acme", { path: ACME }),
    entry("globex/portal", "globex", { path: GLOBEX }),
    { path: OLD_SITE, enabled: true },
  ],
};

async function get(
  url: string,
  env: Record<string, string> = {},
  repoList: unknown = DEFAULT_LIST,
) {
  const claudeDir = await makeClaudeDir(repoList);
  const config = {
    ...loadConfig({ DATABASE_URL: TEST_DATABASE_URL, LOG_LEVEL: "silent", ...env }),
    FOREMAN_CLAUDE_DIR: claudeDir,
  };
  const app = await buildApp({ config, db: database.db, logger: false, now: NOW });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

interface Row {
  day: string;
  label: string;
  client: string | null;
  interactiveMinutes: number;
  messages: number;
  sessions: number;
  tokens: number;
  projectId: string;
}

async function ledger(query = "from=2026-11-12&to=2026-11-12", env: Record<string, string> = {}) {
  const response = await get(`/api/ledger?${query}`, env);
  expect(response.statusCode).toBe(200);
  return response.json<{
    rules: { timeZone: string; idleMinutes: number; leadInMinutes: number };
    range: { from: string; to: string };
    rows: Row[];
    rowCount: number;
    nextCursor: string | null;
    repos: { lines: (Row & { days: number })[]; cut: number };
    totals: { interactiveMinutes: number; messages: number; sessions: number; tokens: number };
  }>();
}

async function fiveMessages() {
  for (const time of ["09:00", "09:10", "09:20", "10:00", "10:05"]) {
    await message(ACME, `2026-11-12T${time}:00.000Z`);
  }
}

describe("GET /api/ledger", () => {
  it("adds the interactive time of the messages to the row of the day", async () => {
    await fiveMessages();

    const body = await ledger();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      day: "2026-11-12",
      label: "acme/payments-api",
      client: "acme",
      interactiveMinutes: 29,
      messages: 5,
      sessions: 1,
    });
  });

  it("shows a day with no message and the tokens of agents that worked alone", async () => {
    await turn(ACME, "2026-11-12T14:00:00.000Z", 1_500_000, "sub-agent");

    const body = await ledger();

    expect(body.rows).toEqual([
      expect.objectContaining({
        interactiveMinutes: 0,
        messages: 0,
        sessions: 0,
        tokens: 1_500_000,
      }),
    ]);
  });

  it("counts the messages of a sibling worktree in the Project", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/a.jsonl", [
      userLine("u1", { cwd: ACME, time: "2026-11-12T09:00:00.000Z", session: "a" }),
      assistantLine("m1", { cwd: ACME, time: "2026-11-12T09:00:30.000Z", session: "a" }),
    ]);
    await writeTranscript(folder.claudeDir, "p/b.jsonl", [
      userLine("u2", {
        cwd: `${ACME}.worktrees/212-add-refunds`,
        time: "2026-11-12T09:05:00.000Z",
        session: "b",
      }),
    ]);
    await ingestTranscripts({ db: database.db, ...folder, log: recordingLog().log });

    const body = await ledger();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      label: "acme/payments-api",
      interactiveMinutes: 7,
      messages: 2,
      sessions: 2,
    });
  });

  describe("two client repos at one time", () => {
    beforeEach(async () => {
      await message(ACME, "2026-11-12T09:00:00.000Z");
      await message(GLOBEX, "2026-11-12T09:05:00.000Z");
      await message(ACME, "2026-11-12T09:12:00.000Z");
    });

    it("counts no minute twice", async () => {
      const body = await ledger();

      const minutes = Object.fromEntries(
        body.rows.map((row) => [row.label, row.interactiveMinutes]),
      );
      expect(minutes).toEqual({ "acme/payments-api": 9, "globex/portal": 5 });
      expect(body.totals.interactiveMinutes).toBe(14);
    });

    it("keeps the time of a row when a client scope hides the other repo", async () => {
      const body = await ledger("from=2026-11-12&to=2026-11-12&client=acme");

      expect(body.rows.map((row) => [row.label, row.interactiveMinutes])).toEqual([
        ["acme/payments-api", 9],
      ]);
      expect(body.totals.interactiveMinutes).toBe(9);
    });
  });

  it("counts a session once for each day and once in the summary", async () => {
    await message(ACME, "2026-11-12T09:00:00.000Z", "one");
    await message(ACME, "2026-11-13T09:00:00.000Z", "one");
    await message(ACME, "2026-11-13T11:00:00.000Z", "two");

    const body = await ledger("from=2026-11-12&to=2026-11-13");

    expect(body.rows.map((row) => [row.day, row.sessions])).toEqual([
      ["2026-11-13", 2],
      ["2026-11-12", 1],
    ]);
    expect(body.repos.lines[0]?.sessions).toBe(2);
    expect(body.totals.sessions).toBe(2);
  });

  it("does not count a session that has only agent turns", async () => {
    await turn(ACME, "2026-11-12T09:00:00.000Z", 10, "sub-agent");

    const body = await ledger();

    expect(body.rows[0]?.sessions).toBe(0);
  });

  it("sums the days, the sessions and the tokens by client repo, with totals", async () => {
    await message(ACME, "2026-11-12T09:00:00.000Z"); // 2 min
    await message(ACME, "2026-11-12T09:10:00.000Z"); // 10 min
    await message(ACME, "2026-11-13T12:00:00.000Z"); // 2 min
    await turn(ACME, "2026-11-12T09:00:00.000Z", 1_000_000);
    await turn(ACME, "2026-11-13T09:00:00.000Z", 2_000_000);
    await turn(ACME, "2026-11-14T09:00:00.000Z", 1_500_000);

    const body = await ledger("from=2026-11-12&to=2026-11-14");

    expect(body.repos.lines).toEqual([
      expect.objectContaining({
        label: "acme/payments-api",
        interactiveMinutes: 14,
        days: 2,
        sessions: 1,
        tokens: 4_500_000,
      }),
    ]);
    expect(body.repos.cut).toBe(0);
    expect(body.totals).toEqual({
      interactiveMinutes: 14,
      messages: 3,
      sessions: 1,
      tokens: 4_500_000,
    });
  });

  it("sorts the summary by client with Unassigned last, then by label", async () => {
    await message(SPIKE, "2026-11-12T08:00:00.000Z");
    await message(GLOBEX, "2026-11-12T09:00:00.000Z");
    await message(ACME, "2026-11-12T10:00:00.000Z");

    const body = await ledger();

    expect(body.repos.lines.map((line) => line.label)).toEqual([
      "acme/payments-api",
      "globex/portal",
      "spike-cli",
    ]);
  });

  it("shows a Project outside the repo list as Unassigned, in All only", async () => {
    await message(SPIKE, "2026-11-12T09:00:00.000Z");
    await message(ACME, "2026-11-12T09:30:00.000Z");

    const all = await ledger();
    const scoped = await ledger("from=2026-11-12&to=2026-11-12&client=acme");

    const spike = all.rows.find((row) => row.label === "spike-cli");
    expect(spike).toMatchObject({ client: null, projectId: projectId(SPIKE) });
    expect(scoped.rows.map((row) => row.label)).toEqual(["acme/payments-api"]);
    // The spike-cli message is on the timeline in both: the next message adds a lead-in.
    expect(scoped.rows[0]?.interactiveMinutes).toBe(2);
  });

  it("labels an entry with no repo by its Project label", async () => {
    await message(OLD_SITE, "2026-11-12T09:00:00.000Z");
    await message(ACME, "2026-11-12T10:00:00.000Z");

    const body = await ledger();

    expect(body.rows.map((row) => row.label).sort()).toEqual(["acme/payments-api", "old-site"]);
  });

  it("uses the ledger time zone for the day", async () => {
    await message(ACME, "2026-07-01T23:30:00.000Z");
    await turn(ACME, "2026-07-01T23:30:00.000Z", 5);

    const body = await ledger("from=2026-07-01&to=2026-07-02");

    expect(body.rows.map((row) => [row.day, row.messages, row.tokens])).toEqual([
      ["2026-07-02", 1, 5],
    ]);
  });

  it("uses the gap from the message before the range", async () => {
    await message(ACME, "2026-11-11T23:55:00.000Z");
    await message(ACME, "2026-11-12T00:05:00.000Z");

    const body = await ledger();

    expect(body.rows[0]?.interactiveMinutes).toBe(10);
  });

  describe("the default range", () => {
    it("is the first day of the month to today in the ledger time zone", async () => {
      const body = await ledger("");

      expect(body.range).toEqual({ from: "2026-11-01", to: "2026-11-15" });
    });
  });

  describe("pages of rows", () => {
    beforeEach(async () => {
      for (let day = 0; day < 130; day += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + day, 12));
        await message(ACME, date.toISOString());
      }
    });

    it("pages with the cursor and keeps the summary and totals", async () => {
      const query = "from=2026-01-01&to=2026-12-31";
      const first = await ledger(query);
      const second = await ledger(`${query}&cursor=${first.nextCursor ?? ""}`);

      expect(first.rows).toHaveLength(100);
      expect(first.rowCount).toBe(130);
      expect(first.nextCursor).not.toBeNull();
      expect(second.rows).toHaveLength(30);
      expect(second.nextCursor).toBeNull();
      expect(second.repos).toEqual(first.repos);
      expect(second.totals).toEqual(first.totals);
      expect(first.totals.messages).toBe(130);
      const days = [...first.rows, ...second.rows].map((row) => row.day);
      expect(days).toEqual([...days].sort().reverse());
      expect(new Set(days).size).toBe(130);
    });
  });

  it.each([
    ["a from after its to", "from=2026-11-20&to=2026-11-01"],
    ["only from", "from=2026-11-01"],
    ["only to", "to=2026-11-01"],
    ["a range of 367 days", "from=2025-01-01&to=2026-01-02"],
    ["a date that does not exist", "from=2026-02-30&to=2026-03-01"],
    ["a limit of 0", "limit=0"],
    ["a limit of 501", "limit=501"],
    ["a cursor that is not valid", "cursor=not-a-cursor!"],
    ["a cursor from another query", `cursor=${Buffer.from("{}").toString("base64url")}`],
    ["an unknown client", "client=nobody"],
    ["a tz value", "tz=UTC"],
  ])("rejects %s with status 400", async (_name, query) => {
    const response = await get(`/api/ledger?${query}`);

    expect(response.statusCode).toBe(400);
  });

  it("accepts a range of 366 days", async () => {
    const response = await get("/api/ledger?from=2025-01-01&to=2026-01-01");

    expect(response.statusCode).toBe(200);
  });

  it("rejects a cursor of another range", async () => {
    for (let day = 0; day < 3; day += 1) {
      await message(ACME, `2026-11-1${String(day)}T12:00:00.000Z`);
    }
    const first = await ledger("from=2026-11-10&to=2026-11-15&limit=1");

    const response = await get(
      `/api/ledger?from=2026-11-01&to=2026-11-15&limit=1&cursor=${first.nextCursor ?? ""}`,
    );

    expect(response.statusCode).toBe(400);
  });

  it("takes the rules from the configuration", async () => {
    await fiveMessages();

    const body = await ledger("from=2026-11-12&to=2026-11-12", {
      FOREMAN_LEDGER_IDLE_MINUTES: "45",
    });

    expect(body.rows[0]?.interactiveMinutes).toBe(67);
    expect(body.rules).toEqual({ timeZone: "Europe/London", idleMinutes: 45, leadInMinutes: 2 });
  });

  it("returns no message text, no message time and no path", async () => {
    const folder = await makeConfigFolder();
    await writeTranscript(folder.claudeDir, "p/a.jsonl", [
      userLine("u1", { cwd: ACME, time: "2026-11-12T09:00:00.000Z" }),
      assistantLine("m1", { cwd: ACME, time: "2026-11-12T09:00:30.000Z" }),
    ]);
    await ingestTranscripts({ db: database.db, ...folder, log: recordingLog().log });

    const response = await get("/api/ledger?from=2026-11-12&to=2026-11-12");

    expect(response.body).not.toContain("SYNTHETIC");
    expect(response.body).not.toContain("09:00");
    expect(response.body).not.toContain("/synthetic");
    expect(Object.keys(response.json<{ rows: object[] }>().rows[0] ?? {}).sort()).toEqual(
      [
        "client",
        "day",
        "interactiveMinutes",
        "label",
        "messages",
        "projectId",
        "repoId",
        "sessions",
        "tokens",
      ].sort(),
    );
  });
});
