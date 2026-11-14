import { schema } from "@foreman/db";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, entryWithoutRepo, makeClaudeDir } from "./repo-list-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table work_repos, work_fetch_runs, turns`);
});

async function seedCached(...repos: string[]) {
  await database.db.insert(schema.workRepos).values(
    repos.map((repo) => {
      const [owner, name] = repo.split("/") as [string, string];
      return {
        id: repoId("github.com", owner, name),
        host: "github.com",
        owner,
        name,
        client: "old",
        forgeState: "ok",
      };
    }),
  );
}

async function cachedNames() {
  const rows = await database.db
    .select()
    .from(schema.workRepos)
    .orderBy(asc(schema.workRepos.name));
  return rows.map((row) => `${row.owner}/${row.name}`);
}

describe("runFetch: the repo list", () => {
  it("ends idle with 0 repos and the reason 'no repo list' when the file is missing", async () => {
    const result = await runFetch({ db: database.db, claudeDir: await makeClaudeDir() });
    expect(result).toMatchObject({ state: "idle", repos: 0, reason: "no repo list" });
    const [run] = await database.db.select().from(schema.workFetchRuns);
    expect(run).toMatchObject({ state: "idle", reposRead: 0, failureReason: "no repo list" });
  });

  it("leaves the usage index alone when the file is missing", async () => {
    await database.db.insert(schema.turns).values({
      turnKey: "t1",
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
    await runFetch({ db: database.db, claudeDir: await makeClaudeDir() });
    expect(await database.db.select().from(schema.turns)).toHaveLength(1);
  });

  it.each([
    ["not valid JSON", '{"repos": ['],
    ["a repos value that is not a list", { repos: "nope" }],
  ])("changes no row and ends 'repo list not readable' for %s", async (_name, content) => {
    await seedCached("acme/app", "acme/lib");
    const result = await runFetch({
      db: database.db,
      claudeDir: await makeClaudeDir(content),
    });
    expect(result).toMatchObject({ state: "idle", reason: "repo list not readable" });
    expect(await cachedNames()).toEqual(["acme/app", "acme/lib"]);
  });

  it("writes the valid repos, and reports the invalid entry with no value", async () => {
    const claudeDir = await makeClaudeDir({
      repos: [entry("acme/app", "acme"), entry("acme/bad", "bad client")],
    });
    const result = await runFetch({ db: database.db, claudeDir });
    expect(result).toMatchObject({ state: "idle", repos: 1, reason: null });
    expect(result.problems).toEqual([{ position: 1, field: "client" }]);
    expect(await cachedNames()).toEqual(["acme/app"]);
  });

  it("keeps the cached rows of a repo whose entry fails validation", async () => {
    await seedCached("acme/bad", "acme/gone");
    const claudeDir = await makeClaudeDir({
      repos: [entry("acme/app", "acme"), entry("acme/bad", "bad client")],
    });
    await runFetch({ db: database.db, claudeDir });
    expect(await cachedNames()).toEqual(["acme/app", "acme/bad"]);
  });

  it("deletes the rows of a repo that a valid list no longer names", async () => {
    await seedCached("acme/gone");
    await runFetch({
      db: database.db,
      claudeDir: await makeClaudeDir({ repos: [entry("acme/app", "acme")] }),
    });
    expect(await cachedNames()).toEqual(["acme/app"]);
  });

  it("deletes every cached row when a valid list names no repo", async () => {
    await seedCached("acme/app", "acme/old");
    const claudeDir = await makeClaudeDir({ repos: [] });
    const result = await runFetch({ db: database.db, claudeDir });
    expect(result).toMatchObject({ state: "idle", repos: 0, reason: null });
    expect(await cachedNames()).toEqual([]);
  });

  it("writes no row for an entry with no repo field", async () => {
    const claudeDir = await makeClaudeDir({ repos: [entryWithoutRepo("acme")] });
    const result = await runFetch({ db: database.db, claudeDir });
    expect(result.repos).toBe(1);
    expect(await cachedNames()).toEqual([]);
  });

  it("deletes no row when an invalid entry names no readable repo", async () => {
    await seedCached("acme/gone");
    await runFetch({
      db: database.db,
      claudeDir: await makeClaudeDir({ repos: [entry("acme/app", "acme"), entry("???", "acme")] }),
    });
    expect(await cachedNames()).toEqual(["acme/app", "acme/gone"]);
  });

  it("fetches a repo once for duplicate entries with the same client", async () => {
    const claudeDir = await makeClaudeDir({
      repos: [entry("Acme/App", "acme"), entry("acme/app", "acme")],
    });
    const result = await runFetch({ db: database.db, claudeDir });
    expect(result.repos).toBe(1);
    expect(await database.db.select().from(schema.workRepos)).toHaveLength(1);
  });

  it("skips both duplicates with different clients and names their positions", async () => {
    await seedCached("acme/app");
    const claudeDir = await makeClaudeDir({
      repos: [entry("Acme/App", "acme"), entry("acme/app", "globex")],
    });
    const result = await runFetch({ db: database.db, claudeDir });
    expect(result.repos).toBe(0);
    expect(result.problems).toEqual([
      { position: 0, field: "client" },
      { position: 1, field: "client" },
    ]);
    expect(await cachedNames()).toEqual(["acme/app"]);
    expect((await database.db.select().from(schema.workRepos))[0]?.client).toBe("old");
  });
});
