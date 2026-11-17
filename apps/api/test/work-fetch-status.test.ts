import { schema } from "@foreman/db";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
  forgeScenario,
  installAdapters,
  pull,
  sha,
  statusAnswer,
  statusKey,
  STATUS_DESCRIPTION,
  TOKEN,
  trackerScenario,
  writeTokens,
  type Scenario,
} from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases, work_commit_statuses, work_fetch_runs`,
  );
});

const REPO = repoId("github.com", "acme", "app");
const T0 = new Date("2026-03-01T10:00:00Z");
const T1 = new Date("2026-03-01T11:00:00Z");
const MACHINE = "factory/machine-gate";
const REVIEW = "factory/release-review";

async function setup() {
  const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme", adapterEntry)] });
  const adapters = await installAdapters(claudeDir);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
  await adapters.setScenario("tracker", trackerScenario([], [], []));
  const fetchAt = (now: Date) =>
    runFetch({
      db: database.db,
      claudeDir,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      now: () => now,
      tokenSource: tokensFile,
    });
  /** Sets the forge scenario: the lists and the status answers. */
  async function forge(all: unknown[], open: unknown[], statuses: Scenario = {}) {
    await adapters.setScenario("forge", { ...forgeScenario(all, open), ...statuses });
  }
  return { adapters, fetchAt, forge };
}

const statusCalls = (calls: string[]) => calls.filter((call) => call.startsWith("status get"));

async function pullRows() {
  return database.db
    .select()
    .from(schema.workPullRequests)
    .orderBy(asc(schema.workPullRequests.number));
}

async function statusRows() {
  return database.db
    .select()
    .from(schema.workCommitStatuses)
    .orderBy(
      asc(schema.workCommitStatuses.pullRequestNumber),
      asc(schema.workCommitStatuses.context),
    );
}

function machineOk(...digits: string[]): Scenario {
  const scenario: Scenario = {};
  for (const digit of digits) {
    scenario[statusKey(sha(digit), MACHINE)] = {
      ok: statusAnswer(sha(digit), MACHINE, "pass"),
    };
  }
  return scenario;
}

describe("Machine gate status reads in a fetch", () => {
  const closedOld = (number: number, digit: string) =>
    pull(number, { state: "closed", head_sha: sha(digit) });
  const open = (number: number, digit: string) => pull(number, { head_sha: sha(digit) });

  it("reads each pull request once in a first fetch, then only open ones and new head shas", async () => {
    const env = await setup();
    const all = [
      open(1, "1"),
      open(2, "2"),
      closedOld(3, "3"),
      closedOld(4, "4"),
      closedOld(5, "5"),
    ];
    await env.forge(all, [all[0], all[1]], machineOk("1", "2", "3", "4", "5", "6"));
    await env.fetchAt(T0);
    expect(statusCalls(await env.adapters.calls("forge")).sort()).toEqual(
      ["1", "2", "3", "4", "5"].map((digit) => statusKey(sha(digit), MACHINE)).sort(),
    );

    await env.adapters.clearCalls();
    const later = [
      open(1, "1"),
      open(2, "2"),
      closedOld(3, "3"),
      closedOld(4, "6"),
      closedOld(5, "5"),
    ];
    await env.forge(later, [later[0], later[1]], machineOk("1", "2", "3", "4", "5", "6"));
    await env.fetchAt(T1);
    expect(statusCalls(await env.adapters.calls("forge")).sort()).toEqual(
      ["1", "2", "6"].map((digit) => statusKey(sha(digit), MACHINE)).sort(),
    );
    const rows = await statusRows();
    expect(rows.find((row) => row.pullRequestNumber === 4)).toMatchObject({ sha: sha("6") });
  });

  it("reads each listed pull request in a full fetch", async () => {
    const env = await setup();
    const all = [open(1, "1"), closedOld(3, "3"), closedOld(4, "4")];
    await env.forge(all, [all[0]], machineOk("1", "3", "4"));
    await env.fetchAt(T0);
    await env.adapters.clearCalls();
    await env.fetchAt(new Date(T0.getTime() + 25 * 3_600_000));
    expect(statusCalls(await env.adapters.calls("forge"))).toHaveLength(3);
  });

  it("stores the repo, the pull request, the context, the sha, the state and the fetch time", async () => {
    const env = await setup();
    const all = [open(1, "a")];
    await env.forge(all, all, {
      [statusKey(sha("a"), MACHINE)]: { ok: statusAnswer(sha("a"), MACHINE, "pending") },
    });
    await env.fetchAt(T0);
    expect(await statusRows()).toEqual([
      {
        repoId: REPO,
        pullRequestNumber: 1,
        context: MACHINE,
        sha: sha("a"),
        state: "pending",
        fetchedAt: T0,
      },
    ]);
  });

  it("never stores the status description", async () => {
    const env = await setup();
    const all = [open(1, "a")];
    await env.forge(all, all, machineOk("a"));
    await env.fetchAt(T0);
    expect(JSON.stringify(await statusRows())).not.toContain(STATUS_DESCRIPTION);
  });

  it("runs no status read for a pull request without a head sha", async () => {
    const env = await setup();
    const all = [pull(1)];
    await env.forge(all, all);
    const result = await env.fetchAt(T0);
    expect(result.state).toBe("idle");
    expect(statusCalls(await env.adapters.calls("forge"))).toEqual([]);
    expect(await pullRows()).toMatchObject([{ headSha: null }]);
  });

  it("caches the head sha of each pull request", async () => {
    const env = await setup();
    const all = [open(1, "a"), closedOld(2, "b")];
    await env.forge(all, [all[0]], machineOk("a", "b"));
    await env.fetchAt(T0);
    expect((await pullRows()).map((row) => row.headSha)).toEqual([sha("a"), sha("b")]);
  });
});

describe("Release review status reads in a fetch", () => {
  const releasePull = (number: number, over: Record<string, unknown>, digit: string) =>
    pull(number, { base: "production", head_sha: sha(digit), ...over });

  it("reads the release review of an open release pull request in each fetch", async () => {
    const env = await setup();
    const all = [
      releasePull(330, { head: "release/2.3" }, "b"),
      releasePull(331, { head: "release/2.4-try" }, "c"),
      releasePull(300, { head: "release/2.2", state: "closed" }, "d"),
    ];
    const open = [all[0], all[1]];
    const statuses: Scenario = {
      ...machineOk("b", "c", "d"),
      [statusKey(sha("b"), REVIEW)]: { ok: statusAnswer(sha("b"), REVIEW, "pass") },
    };
    await env.forge(all, open, statuses);
    await env.fetchAt(T0);
    const reviewCalls = (calls: string[]) => calls.filter((call) => call.endsWith(REVIEW));
    expect(reviewCalls(await env.adapters.calls("forge"))).toEqual([statusKey(sha("b"), REVIEW)]);

    await env.adapters.clearCalls();
    await env.fetchAt(T1);
    expect(reviewCalls(await env.adapters.calls("forge"))).toEqual([statusKey(sha("b"), REVIEW)]);
    expect(statusCalls(await env.adapters.calls("forge")).sort()).toEqual(
      [
        statusKey(sha("b"), MACHINE),
        statusKey(sha("b"), REVIEW),
        statusKey(sha("c"), MACHINE),
      ].sort(),
    );
    const rows = await statusRows();
    expect(rows.filter((row) => row.context === REVIEW)).toMatchObject([
      { pullRequestNumber: 330, sha: sha("b"), state: "pass", fetchedAt: T1 },
    ]);
  });

  it("reads no release review when the base is not production", async () => {
    const env = await setup();
    const all = [pull(1, { head: "release/2.3", head_sha: sha("a") })];
    await env.forge(all, all, machineOk("a"));
    await env.fetchAt(T0);
    expect(statusCalls(await env.adapters.calls("forge"))).toEqual([statusKey(sha("a"), MACHINE)]);
  });
});

describe("Status failures", () => {
  const open = (number: number, digit: string) => pull(number, { head_sha: sha(digit) });

  it("keeps the cached row, marks the pull request and makes the repo partial", async () => {
    const env = await setup();
    const all = [open(1, "a")];
    await env.forge(all, all, machineOk("a"));
    await env.fetchAt(T0);

    const moved = [open(1, "b")];
    await env.forge(moved, moved, {
      [statusKey(sha("b"), MACHINE)]: { error: "HTTP 404 Not Found" },
    });
    const result = await env.fetchAt(T1);
    expect(result.state).toBe("idle");
    expect(await statusRows()).toMatchObject([{ sha: sha("a"), state: "pass", fetchedAt: T0 }]);
    expect(await pullRows()).toMatchObject([{ headSha: sha("b"), detailsErrorClass: "not_found" }]);
    const [repo] = await database.db.select().from(schema.workRepos);
    expect(repo).toMatchObject({ forgeState: "partial", forgeErrorClass: "not_found" });
  });

  it.each([
    ["another sha", { sha: sha("b"), context: MACHINE, state: "pass" }],
    ["another context", { sha: sha("a"), context: REVIEW, state: "pass" }],
    ["a state that is not known", { sha: sha("a"), context: MACHINE, state: "green" }],
    ["a key that is not known", { sha: sha("a"), context: MACHINE, state: "pass", extra: 1 }],
  ])("stores nothing and marks invalid_output for %s", async (_name, output) => {
    const env = await setup();
    const all = [open(1, "a")];
    await env.forge(all, all, {
      [statusKey(sha("a"), MACHINE)]: { ok: { description: STATUS_DESCRIPTION, ...output } },
    });
    await env.fetchAt(T0);
    expect(await statusRows()).toEqual([]);
    expect(await pullRows()).toMatchObject([{ detailsErrorClass: "invalid_output" }]);
  });

  it("reads a closed pull request again in the next fetch when its first read failed", async () => {
    const env = await setup();
    const all = [pull(1, { state: "closed", head_sha: sha("a") })];
    await env.forge(all, [], { [statusKey(sha("a"), MACHINE)]: { error: "HTTP 404 Not Found" } });
    await env.fetchAt(T0);
    await env.adapters.clearCalls();
    await env.forge(all, [], machineOk("a"));
    const result = await env.fetchAt(T1);
    expect(statusCalls(await env.adapters.calls("forge"))).toEqual([statusKey(sha("a"), MACHINE)]);
    expect(result.state).toBe("idle");
    expect(await pullRows()).toMatchObject([{ detailsErrorClass: null }]);
    const [repo] = await database.db.select().from(schema.workRepos);
    expect(repo).toMatchObject({ forgeState: "ok", forgeErrorClass: null });
  });
});

describe("The linked issue number", () => {
  it.each([
    ["84-commit-status-cache", 84],
    ["7-x", 7],
    ["feature/84-x", null],
    ["release/2.3", null],
    ["84", null],
    ["x-84-y", null],
    ["99999999999-x", null],
  ])("reads %s as %s", async (head, expected) => {
    const env = await setup();
    const all = [pull(1, { head })];
    await env.forge(all, all);
    await env.fetchAt(T0);
    expect(await pullRows()).toMatchObject([{ linkedIssue: expected }]);
  });
});
