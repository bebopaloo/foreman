import { schema } from "@foreman/db";
import { WorkBlockersResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { blockersOfRepo, compareBlockers } from "../src/work/blockers.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import { writeTokens } from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table work_repos, work_issues`);
});

const ACME_APP = repoId("github.com", "acme", "app");
const MISC_TOOL = repoId("github.com", "misc", "tool");
const T0 = new Date("2026-01-01T00:00:00Z");
const REPO = { id: ACME_APP, host: "github.com", fullName: "acme/app" };

function issue(
  number: number,
  blockedBy: number[] = [],
  over: Partial<Parameters<typeof blockersOfRepo>[1][number]> = {},
) {
  return {
    number,
    title: `Issue ${String(number)}`,
    state: "open",
    issueState: "READY",
    labels: [] as string[],
    link: null,
    blockedBy,
    ...over,
  };
}

const byNumber = (list: ReturnType<typeof blockersOfRepo>) =>
  Object.fromEntries(list.map((b) => [b.number, b.cutsOff]));

describe("blockersOfRepo", () => {
  it("counts the issues that a blocker cuts off through the chain", () => {
    // A(1) blocks B(2), B blocks C(3), D(4) blocks C.
    const list = blockersOfRepo(REPO, [issue(1), issue(2, [1]), issue(3, [2, 4]), issue(4)]);
    expect(byNumber(list)).toEqual({ 1: [2, 3], 2: [3], 4: [3] });
    expect(list.find((b) => b.number === 1)?.direct).toEqual([2]);
  });

  it("does not count a DONE, CANCELLED or closed issue as cut off or as a blocker", () => {
    const list = blockersOfRepo(REPO, [
      issue(1),
      issue(2, [1], { issueState: "DONE" }),
      issue(3, [1], { state: "closed" }),
      issue(4, [1]),
      issue(5, [], { issueState: "DONE" }),
      issue(6, [5]),
    ]);
    expect(byNumber(list)).toEqual({ 1: [4] });
  });

  it("stops at a cycle and never counts an issue as its own dependent", () => {
    const list = blockersOfRepo(REPO, [issue(1, [2]), issue(2, [1]), issue(3, [3])]);
    expect(byNumber(list)).toEqual({ 1: [2], 2: [1] });
  });
});

describe("compareBlockers", () => {
  it("puts BLOCKED first, then attended-only, then the larger count", () => {
    const list = blockersOfRepo(REPO, [
      issue(1),
      issue(2, [1]),
      issue(3, [1]),
      issue(4, [], { labels: ["attended-only"] }),
      issue(5, [4]),
      issue(6, [], { issueState: "BLOCKED" }),
      issue(7, [6]),
      issue(8),
      issue(9, [8]),
    ]);
    expect(list.sort(compareBlockers).map((b) => b.number)).toEqual([6, 4, 1, 8]);
  });
});

async function appFor() {
  const claudeDir = await makeClaudeDir({
    repos: [entry("acme/app", "acme"), entry("misc/tool")],
  });
  const tokensFile = await writeTokens(claudeDir, {
    "github.com/acme": "t",
    "github.com/misc": "t",
  });
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false });
}

const row = (repo: string, number: number, blockedBy: number[] = []) => ({
  repoId: repo,
  number,
  title: `Issue ${String(number)}`,
  state: "open",
  issueState: "READY",
  priority: "high",
  labels: [],
  author: "synth-author",
  link: `https://github.com/acme/app/issues/${String(number)}`,
  blockedBy,
  lastListedAt: T0,
});

describe("GET /api/work/blockers", () => {
  it("returns the blockers of the scope with their counts, and applies the limit", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        row(ACME_APP, 1),
        row(ACME_APP, 2, [1]),
        row(ACME_APP, 3, [2, 4]),
        row(ACME_APP, 4),
        row(MISC_TOOL, 1),
        row(MISC_TOOL, 2, [1]),
      ]);
    const all = WorkBlockersResponse.parse(
      (await app.inject({ method: "GET", url: "/api/work/blockers" })).json<unknown>(),
    );
    expect(all.total).toBe(4);
    expect(all.items.map((b) => [b.repo, b.number, b.cutsOff.length])).toEqual([
      ["acme/app", 1, 2],
      ["acme/app", 2, 1],
      ["acme/app", 4, 1],
      ["misc/tool", 1, 1],
    ]);
    expect(all.items[0]?.link).toBe("https://github.com/acme/app/issues/1");
    const scoped = WorkBlockersResponse.parse(
      (
        await app.inject({ method: "GET", url: "/api/work/blockers?client=acme&limit=1" })
      ).json<unknown>(),
    );
    expect(scoped.total).toBe(3);
    expect(scoped.items).toHaveLength(1);
    await app.close();
  });

  it("refuses an unknown client", async () => {
    const app = await appFor();
    const response = await app.inject({ method: "GET", url: "/api/work/blockers?client=nope" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
