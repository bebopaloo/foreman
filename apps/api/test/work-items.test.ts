import path from "node:path";
import { schema } from "@foreman/db";
import { WorkItemsResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { repoId } from "../src/work/repo-list.ts";
import { gateEvent, isoSeconds, NOW, writeJsonl } from "./dash-fixtures.ts";
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
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_commit_statuses`,
  );
});

const APP = repoId("github.com", "acme", "app");
const WEB = repoId("github.com", "acme", "web");
const TOOL = repoId("github.com", "misc", "tool");
const GLOBEX = repoId("github.com", "globex", "api");
const T0 = new Date("2026-11-15T00:00:00Z");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TOKENS = {
  "github.com/acme": "t",
  "github.com/misc": "t",
  "github.com/globex": "t",
};

interface Setup {
  repos?: unknown[];
  tokens?: Record<string, string>;
  events?: { date: string; lines: (Record<string, unknown> | string)[] }[];
}

async function appFor({ repos, tokens = TOKENS, events = [] }: Setup = {}) {
  const claudeDir = await makeClaudeDir({
    repos: repos ?? [
      entry("acme/app", "acme"),
      entry("acme/web", "acme"),
      entry("globex/api", "globex"),
      entry("misc/tool"),
    ],
  });
  const tokensFile = await writeTokens(claudeDir, tokens);
  for (const { date, lines } of events) {
    await writeJsonl(path.join(claudeDir, "factory"), "controls", date, lines);
  }
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false, now: () => NOW });
}

type App = Awaited<ReturnType<typeof appFor>>;

async function get(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function items(app: App, url = "/api/work/items") {
  const { status, body } = await get(app, url);
  expect(status).toBe(200);
  return WorkItemsResponse.parse(body);
}

function issue(
  repo: string,
  number: number,
  over: Partial<typeof schema.workIssues.$inferInsert> = {},
) {
  return {
    repoId: repo,
    number,
    title: `Issue ${String(number)}`,
    state: "open",
    issueState: "READY",
    priority: "high",
    labels: [],
    author: "synth-author",
    link: null,
    lastListedAt: T0,
    ...over,
  };
}

function pull(
  repo: string,
  number: number,
  over: Partial<typeof schema.workPullRequests.$inferInsert> = {},
) {
  return {
    repoId: repo,
    number,
    title: `Pull ${String(number)}`,
    state: "open",
    draft: false,
    headBranch: "feature",
    baseBranch: "main",
    author: "synth-author",
    checks: "success",
    labels: [],
    link: null,
    lastListedAt: T0,
    ...over,
  };
}

function status(
  repo: string,
  pr: number,
  sha: string,
  state: string,
  context = "factory/machine-gate",
) {
  return { repoId: repo, pullRequestNumber: pr, context, sha, state, fetchedAt: T0 };
}

const kinds = (page: WorkItemsResponse) =>
  page.items.map((row) => [
    row.fullName,
    row.issue?.number ?? null,
    row.pullRequest?.number ?? null,
  ]);

describe("GET /api/work/items rows", () => {
  it("joins an issue to its pull request with the gate, round and risk tier", async () => {
    const app = await appFor({
      events: [
        {
          date: "2026-11-15",
          lines: [
            gateEvent({
              pr: 40,
              round: 1,
              decision: "fail",
              time: isoSeconds(new Date("2026-11-15T09:00:00Z")),
            }),
            gateEvent({
              pr: 40,
              round: 2,
              decision: "pass",
              time: isoSeconds(new Date("2026-11-15T10:00:00Z")),
            }),
          ],
        },
      ],
    });
    await database.db.insert(schema.workIssues).values(
      issue(APP, 12, {
        title: "Add the export",
        issueState: "IN REVIEW",
        labels: ["type:feature"],
        link: "https://github.com/acme/app/issues/12",
      }),
    );
    await database.db.insert(schema.workPullRequests).values(
      pull(APP, 40, {
        headBranch: "12-add-the-export",
        labels: ["risk:sensitive"],
        headSha: SHA_A,
        linkedIssue: 12,
        link: "https://github.com/acme/app/pull/40",
      }),
    );
    await database.db.insert(schema.workCommitStatuses).values(status(APP, 40, SHA_A, "pass"));
    const page = await items(app);
    expect(page.items).toEqual([
      {
        repoId: APP,
        fullName: "acme/app",
        client: "acme",
        context: null,
        issue: {
          number: 12,
          title: "Add the export",
          state: "open",
          issueState: "IN REVIEW",
          type: "feature",
          priority: "high",
          link: "https://github.com/acme/app/issues/12",
          stale: false,
        },
        pullRequest: {
          number: 40,
          title: "Pull 40",
          state: "open",
          draft: false,
          checks: "success",
          link: "https://github.com/acme/app/pull/40",
          stale: false,
          otherCount: 0,
        },
        machineGate: { source: "forge", value: "pass" },
        round: 2,
        riskTier: "sensitive",
      },
    ]);
  });

  it("shows no pull request columns for an issue with no pull request", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values(issue(APP, 15));
    const [row] = (await items(app)).items;
    expect(row).toMatchObject({
      pullRequest: null,
      machineGate: null,
      round: null,
      riskTier: null,
    });
  });

  it("links a pull request only to the issue that its linked number names", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values([issue(APP, 12), issue(APP, 123)]);
    await database.db
      .insert(schema.workPullRequests)
      .values(pull(APP, 50, { headBranch: "123-fix-the-total", linkedIssue: 123 }));
    const page = await items(app);
    expect(kinds(page)).toEqual([
      ["acme/app", 123, 50],
      ["acme/app", 12, null],
    ]);
  });

  it("shows the open pull request with the highest number and counts the others", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values(issue(APP, 12));
    await database.db
      .insert(schema.workPullRequests)
      .values([
        pull(APP, 40, { state: "closed", linkedIssue: 12 }),
        pull(APP, 44, { linkedIssue: 12 }),
        pull(APP, 46, { state: "merged", linkedIssue: 12 }),
      ]);
    let page = await items(app);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.pullRequest).toMatchObject({ number: 44, otherCount: 2 });
    await database.db.update(schema.workPullRequests).set({ state: "closed" });
    page = await items(app);
    expect(page.items[0]?.pullRequest).toMatchObject({ number: 46, otherCount: 2 });
  });

  it("gives a pull request with no cached issue its own row", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workPullRequests)
      .values([
        pull(APP, 50, { title: "Release 1.2", headBranch: "release/1.2" }),
        pull(APP, 51, { headBranch: "20-old-work", linkedIssue: 20 }),
      ]);
    const page = await items(app);
    expect(page.items.map((row) => [row.issue, row.pullRequest?.number])).toEqual([
      [null, 51],
      [null, 50],
    ]);
    expect(page.counts.none).toBe(2);
  });

  it("reads the Machine gate from the forge status before the events", async () => {
    const app = await appFor({
      events: [{ date: "2026-11-15", lines: [gateEvent({ pr: 40, decision: "fail" })] }],
    });
    await database.db.insert(schema.workPullRequests).values(pull(APP, 40, { headSha: SHA_A }));
    await database.db.insert(schema.workCommitStatuses).values(status(APP, 40, SHA_A, "pending"));
    expect((await items(app)).items[0]?.machineGate).toEqual({ source: "forge", value: "pending" });
  });

  it("reads the Machine gate from the newest event when the pull request has no head sha", async () => {
    const app = await appFor({
      events: [
        {
          date: "2026-11-15",
          lines: [
            gateEvent({ pr: 40, round: 3, decision: "blocked" }),
            gateEvent({ pr: 41, round: 1, decision: "wait", repo: "acme/web" }),
          ],
        },
      ],
    });
    await database.db.insert(schema.workPullRequests).values([pull(APP, 40), pull(APP, 42)]);
    const page = await items(app);
    const byNumber = new Map(page.items.map((row) => [row.pullRequest?.number, row]));
    expect(byNumber.get(40)).toMatchObject({
      machineGate: { source: "events", value: "blocked" },
      round: 3,
    });
    expect(byNumber.get(42)).toMatchObject({ machineGate: null, round: null });
  });

  it("does not use a status for an older head commit", async () => {
    const app = await appFor({
      events: [{ date: "2026-11-15", lines: [gateEvent({ pr: 40, decision: "wait" })] }],
    });
    await database.db.insert(schema.workPullRequests).values(pull(APP, 40, { headSha: SHA_B }));
    await database.db.insert(schema.workCommitStatuses).values(status(APP, 40, SHA_A, "pass"));
    expect((await items(app)).items[0]?.machineGate).toEqual({ source: "events", value: "wait" });
  });

  it("shows a status of none on the head commit as the forge value none", async () => {
    const app = await appFor();
    await database.db.insert(schema.workPullRequests).values(pull(APP, 40, { headSha: SHA_B }));
    await database.db.insert(schema.workCommitStatuses).values(status(APP, 40, SHA_B, "none"));
    expect((await items(app)).items[0]?.machineGate).toEqual({ source: "forge", value: "none" });
  });

  it("ignores the release review status", async () => {
    const app = await appFor();
    await database.db.insert(schema.workPullRequests).values(pull(APP, 40, { headSha: SHA_B }));
    await database.db
      .insert(schema.workCommitStatuses)
      .values(status(APP, 40, SHA_B, "pass", "factory/release-review"));
    expect((await items(app)).items[0]?.machineGate).toBeNull();
  });

  it("takes the round from the events of this repo and this pull request in the last 30 days", async () => {
    const app = await appFor({
      events: [
        {
          date: "2026-11-15",
          lines: [
            gateEvent({ pr: 40, round: 1 }),
            gateEvent({ pr: 40, round: 3 }),
            gateEvent({ pr: 40, round: 2 }),
            gateEvent({ pr: 40, round: 2, repo: "acme/web" }),
          ],
        },
        {
          date: "2026-10-15",
          lines: [gateEvent({ pr: 41, round: 1, time: "2026-10-15T12:00:00Z" })],
        },
      ],
    });
    await database.db.insert(schema.workPullRequests).values([pull(APP, 40), pull(APP, 41)]);
    const page = await items(app);
    expect(page.items.map((row) => [row.pullRequest?.number, row.round])).toEqual([
      [41, null],
      [40, 3],
    ]);
  });

  it("lists the connected repos with no Control event", async () => {
    const app = await appFor({
      events: [{ date: "2026-11-15", lines: [gateEvent({ pr: 40 })] }],
    });
    await database.db
      .insert(schema.workPullRequests)
      .values([pull(APP, 40), pull(WEB, 7, { checks: "failure" })]);
    const page = await items(app);
    expect(page.noControlEvents).toEqual([WEB]);
    expect(page.items.find((row) => row.fullName === "acme/web")).toMatchObject({
      pullRequest: { checks: "failure" },
      round: null,
    });
  });

  it("takes the highest risk tier and ignores another tier word", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workPullRequests)
      .values([
        pull(APP, 40, { labels: ["risk:general", "risk:authority"] }),
        pull(APP, 41, { labels: ["risk:extreme"] }),
        pull(APP, 42),
      ]);
    const tiers = (await items(app)).items.map((row) => [row.pullRequest?.number, row.riskTier]);
    expect(tiers).toEqual([
      [42, null],
      [41, null],
      [40, "authority"],
    ]);
  });

  it("derives the issue type from the type labels", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 12, { labels: ["type:fix"] }),
        issue(APP, 13),
        issue(APP, 14, { labels: ["type:fix", "type:chore"] }),
        issue(APP, 15, { labels: ["type:bug"] }),
      ]);
    const types = (await items(app)).items.map((row) => [row.issue?.number, row.issue?.type]);
    expect(types).toEqual([
      [15, null],
      [14, "multiple"],
      [13, null],
      [12, "fix"],
    ]);
  });

  it("keeps the state of a closed issue and marks a dropped item as stale", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values([
      issue(APP, 1, {
        state: "closed",
        issueState: "TODO",
        lastListedAt: new Date("2026-11-14T00:00:00Z"),
      }),
      issue(APP, 2),
    ]);
    const page = await items(app);
    const closed = page.items.find((row) => row.issue?.number === 1);
    expect(closed?.issue).toMatchObject({ state: "closed", issueState: "TODO", stale: true });
  });

  it("sends no text beyond the structured fields", async () => {
    const app = await appFor({
      events: [
        { date: "2026-11-15", lines: [gateEvent({ pr: 40, counts: { blocker: 1 }, refs: ["x"] })] },
      ],
    });
    await database.db.insert(schema.workIssues).values(issue(APP, 12));
    await database.db.insert(schema.workPullRequests).values(pull(APP, 40, { linkedIssue: 12 }));
    const { body } = await get(app, "/api/work/items");
    const text = JSON.stringify(WorkItemsResponse.parse(body).items);
    expect(text).not.toContain("counts");
    expect(text).not.toContain("refs");
    expect(text).not.toContain("description");
    expect(text).not.toContain("body");
  });
});

describe("GET /api/work/items filters and counts", () => {
  async function seedStates() {
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 1),
        issue(APP, 2),
        issue(APP, 3),
        issue(APP, 4, { issueState: "BLOCKED" }),
        issue(APP, 5, { issueState: "BLOCKED" }),
        issue(APP, 6, { issueState: "DONE", state: "closed" }),
      ]);
    await database.db.insert(schema.workPullRequests).values(pull(APP, 60));
  }

  it("counts each Issue state and filters by one", async () => {
    const app = await appFor();
    await seedStates();
    const all = await items(app);
    expect(all.counts).toEqual({
      all: 7,
      TODO: 0,
      READY: 3,
      "IN PROGRESS": 0,
      "IN REVIEW": 0,
      BLOCKED: 2,
      DONE: 1,
      CANCELLED: 0,
      none: 1,
    });
    const blocked = await items(app, "/api/work/items?issue_state=BLOCKED");
    expect(blocked.items.map((row) => row.issue?.number)).toEqual([5, 4]);
    expect(blocked.counts.all).toBe(7);
    const none = await items(app, "/api/work/items?issue_state=none");
    expect(none.items.map((row) => row.pullRequest?.number)).toEqual([60]);
    const spaced = await items(app, "/api/work/items?issue_state=IN%20PROGRESS");
    expect(spaced.items).toEqual([]);
  });

  it("filters by type, priority and repo, and the counts follow those filters", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 1, { labels: ["type:feature"], priority: "high" }),
        issue(APP, 2, { labels: ["type:feature"], priority: "high" }),
        issue(APP, 3, { labels: ["type:fix"], priority: "high" }),
        issue(APP, 4, { labels: ["type:feature"], priority: "low" }),
        issue(WEB, 5, { labels: ["type:feature"], priority: "high" }),
      ]);
    const page = await items(
      app,
      `/api/work/items?type=feature&priority=high&repo=${APP}&issue_state=READY`,
    );
    expect(page.items.map((row) => row.issue?.number)).toEqual([2, 1]);
    expect(page.counts.all).toBe(2);
    expect(page.counts.READY).toBe(2);
  });

  it("leaves out rows with no issue when a type or priority filter is set", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values(issue(APP, 1, { priority: "none" }));
    await database.db.insert(schema.workPullRequests).values(pull(APP, 60));
    for (const query of ["type=none", "priority=none"]) {
      const page = await items(app, `/api/work/items?${query}`);
      expect(page.items.map((row) => row.issue?.number)).toEqual([1]);
    }
  });

  it("filters by multiple types", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 1, { labels: ["type:fix", "type:chore"] }),
        issue(APP, 2, { labels: ["type:fix"] }),
      ]);
    const page = await items(app, "/api/work/items?type=multiple");
    expect(page.items.map((row) => row.issue?.number)).toEqual([1]);
  });
});

describe("GET /api/work/items sort and paging", () => {
  it("sorts by priority, by state, and by repo with the number from high to low", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 1, { priority: "low", issueState: "DONE" }),
        issue(APP, 2, { priority: "highest", issueState: "BLOCKED" }),
        issue(APP, 3, { priority: "none", issueState: "TODO" }),
        issue(WEB, 4, { priority: "high", issueState: "READY" }),
        issue(APP, 5, { priority: "high", issueState: "IN REVIEW" }),
      ]);
    await database.db.insert(schema.workPullRequests).values(pull(APP, 60));
    const numbers = (page: WorkItemsResponse) =>
      page.items.map((row) => row.issue?.number ?? `pr${String(row.pullRequest?.number)}`);
    expect(numbers(await items(app))).toEqual(["pr60", 5, 3, 2, 1, 4]);
    expect(numbers(await items(app, "/api/work/items?sort=priority"))).toEqual([
      2,
      5,
      4,
      1,
      3,
      "pr60",
    ]);
    expect(numbers(await items(app, "/api/work/items?sort=state"))).toEqual([
      3,
      4,
      5,
      2,
      1,
      "pr60",
    ]);
  });

  it("orders the default sort by owner/name, then number from high to low", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([issue(WEB, 9), issue(APP, 1), issue(APP, 3), issue(TOOL, 2)]);
    await database.db.insert(schema.workPullRequests).values(pull(APP, 7));
    expect(kinds(await items(app))).toEqual([
      ["acme/app", null, 7],
      ["acme/app", 3, null],
      ["acme/app", 1, null],
      ["acme/web", 9, null],
      ["misc/tool", 2, null],
    ]);
  });

  it("pages 230 rows as 100, 100 and 30 and refuses a cursor of another query", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values(Array.from({ length: 230 }, (_, index) => issue(APP, index + 1)));
    const first = await items(app);
    const second = await items(app, `/api/work/items?cursor=${first.nextCursor ?? ""}`);
    const third = await items(app, `/api/work/items?cursor=${second.nextCursor ?? ""}`);
    expect([first.items.length, second.items.length, third.items.length]).toEqual([100, 100, 30]);
    expect(third.nextCursor).toBeNull();
    const seen = new Set(
      [...first.items, ...second.items, ...third.items].map((row) => row.issue?.number),
    );
    expect(seen.size).toBe(230);
    for (const other of [
      "sort=priority",
      "issue_state=READY",
      "type=none",
      "priority=high",
      `repo=${APP}`,
      "client=acme",
    ]) {
      const { status: code } = await get(
        app,
        `/api/work/items?${other}&cursor=${first.nextCursor ?? ""}`,
      );
      expect(code).toBe(400);
    }
  });

  it("refuses limits and cursors that are not valid", async () => {
    const app = await appFor();
    for (const query of ["limit=501", "limit=0", "cursor=not-a-cursor!"]) {
      expect((await get(app, `/api/work/items?${query}`)).status).toBe(400);
    }
  });

  it("refuses query values that are not valid", async () => {
    const app = await appFor();
    for (const query of ["issue_state=DOING", "type=bug", "sort=title", "q=x", "priority=urgent"]) {
      expect((await get(app, `/api/work/items?${query}`)).status).toBe(400);
    }
  });
});

describe("GET /api/work/items scope and Control events", () => {
  it("limits the rows and the counts to the client", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issue(APP, 1),
        issue(APP, 2),
        issue(WEB, 3),
        issue(WEB, 4),
        issue(GLOBEX, 5),
        issue(GLOBEX, 6),
        issue(TOOL, 7),
      ]);
    const acme = await items(app, "/api/work/items?client=acme");
    expect(acme.items).toHaveLength(4);
    expect(acme.counts.all).toBe(4);
    expect((await items(app)).items).toHaveLength(7);
    expect((await get(app, `/api/work/items?client=acme&repo=${GLOBEX}`)).status).toBe(400);
    expect((await get(app, "/api/work/items?client=nobody")).status).toBe(400);
  });

  it("reports not_connected and counts the repos with no cache rows", async () => {
    const app = await appFor({ tokens: { "github.com/acme": "t" } });
    const empty = await items(app);
    expect(empty).toMatchObject({ state: "not_connected", items: [], complete: 4 });
    await database.db.insert(schema.workIssues).values(issue(APP, 1));
    const some = await items(app);
    expect(some.state).toBe("ok");
    expect(some.complete).toBe(3);
  });

  it("reads the tokens of FOREMAN_TOKENS_JSON, with no tokens file", async () => {
    const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme")] });
    await database.db.insert(schema.workIssues).values(issue(APP, 1));
    const withTokens = await buildApp({
      config: {
        ...testConfig,
        FOREMAN_CLAUDE_DIR: claudeDir,
        FOREMAN_TOKENS_JSON: new Map([["github.com/acme", "t"]]),
      },
      db: database.db,
      logger: false,
      now: () => NOW,
    });
    expect((await items(withTokens)).state).toBe("ok");
    const withoutTokens = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
      now: () => NOW,
    });
    expect((await items(withoutTokens)).state).toBe("not_connected");
  });

  it("counts a repo with a fetch error as incomplete", async () => {
    const app = await appFor({ repos: [entry("acme/app", "acme")] });
    await database.db.insert(schema.workIssues).values(issue(APP, 1));
    await database.db.insert(schema.workRepos).values({
      id: APP,
      host: "github.com",
      owner: "acme",
      name: "app",
      client: "acme",
      forgeErrorClass: "timeout",
    });
    expect((await items(app)).complete).toBe(1);
  });

  it("uses the other Control events and counts the skipped lines", async () => {
    const app = await appFor({
      events: [
        {
          date: "2026-11-15",
          lines: ["{not json", gateEvent({ pr: 40, round: 4 }), gateEvent({ pr: 41, round: 2 })],
        },
      ],
    });
    await database.db.insert(schema.workPullRequests).values([pull(APP, 40), pull(APP, 41)]);
    const page = await items(app);
    expect(page.skipped).toEqual({ controlEvents: 2, files: 0 });
    expect(page.items.map((row) => [row.pullRequest?.number, row.round])).toEqual([
      [41, 2],
      [40, null],
    ]);
  });

  it("logs the file name and the count, never a line", async () => {
    const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme")] });
    await writeJsonl(path.join(claudeDir, "factory"), "controls", "2026-11-15", [
      "{secret-line-content",
    ]);
    const tokensFile = await writeTokens(claudeDir, TOKENS);
    const lines: string[] = [];
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile },
      db: database.db,
      logger: { level: "warn", stream: { write: (line: string) => void lines.push(line) } },
      now: () => NOW,
    });
    await app.inject({ method: "GET", url: "/api/work/items" });
    const log = lines.join("");
    expect(log).toContain("2026-11-15.jsonl");
    expect(log).not.toContain("secret-line-content");
  });
});
