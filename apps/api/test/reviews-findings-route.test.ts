import path from "node:path";
import { schema } from "@foreman/db";
import { FindingsResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { OK_STATE } from "../src/work/fetch-repo.ts";
import { repoId } from "../src/work/repo-list.ts";
import { NOW, writeJsonl } from "./dash-fixtures.ts";
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
  await database.db.execute(sql`truncate table work_repos, work_issues, work_pull_requests`);
});

const APP = repoId("github.com", "acme", "app");

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    time: "2026-11-15T10:00:00Z",
    run_id: null,
    repo: "acme/app",
    pr: 7,
    issue: null,
    round: 1,
    sha: null,
    fingerprint: "0123456789abcdef",
    pass: "Security",
    category: "injection",
    severity: "major",
    refs: [],
    file: "src/db.ts",
    line: 12,
    status: "verified",
    outcome: "open",
    thread: null,
    ...over,
  };
}

async function appFor(lines: (Record<string, unknown> | string)[]) {
  const claudeDir = await makeClaudeDir({
    repos: [entry("acme/app", "acme"), entry("globex/portal", "globex")],
  });
  const tokensFile = await writeTokens(claudeDir, {
    "github.com/acme": "t",
    "github.com/globex": "t",
  });
  if (lines.length > 0)
    await writeJsonl(path.join(claudeDir, "factory"), "findings", "2026-11-15", lines);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false, now: () => NOW });
}

async function findings(app: Awaited<ReturnType<typeof appFor>>, query = "") {
  const response = await app.inject({ method: "GET", url: `/api/reviews/findings${query}` });
  expect(response.statusCode).toBe(200);
  return FindingsResponse.parse(response.json<unknown>());
}

describe("GET /api/reviews/findings", () => {
  it("reports a missing ledger folder", async () => {
    const body = await findings(await appFor([]));
    expect(body.folder).toBe("missing");
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns the latest outcome of each fingerprint with the pull request link", async () => {
    const app = await appFor([
      line({ time: "2026-11-15T08:00:00Z" }),
      line({ time: "2026-11-15T09:00:00Z", round: 2, outcome: "fixed" }),
      "not json",
    ]);
    await database.db.insert(schema.workRepos).values({
      id: APP,
      host: "github.com",
      owner: "acme",
      name: "app",
      forgeState: OK_STATE,
      lastGoodFetchAt: NOW,
    });
    await database.db.insert(schema.workPullRequests).values({
      repoId: APP,
      number: 7,
      title: "Synthetic",
      state: "open",
      draft: false,
      headBranch: "b",
      baseBranch: "main",
      author: "synth",
      checks: "success",
      labels: [],
      link: "https://github.com/acme/app/pull/7",
      lastListedAt: NOW,
    });
    const body = await findings(app);
    expect(body.skippedLines).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      outcome: "fixed",
      round: 1,
      link: "https://github.com/acme/app/pull/7",
    });
    expect(body.security.bySeverity.major).toMatchObject({ fixed: 1, total: 1 });
  });

  it("filters, scopes by client and pages", async () => {
    const app = await appFor([
      line({ fingerprint: "a000000000000000", time: "2026-11-15T08:00:00Z" }),
      line({ fingerprint: "b000000000000000", time: "2026-11-15T09:00:00Z", severity: "minor" }),
      line({ fingerprint: "c000000000000000", repo: "globex/portal", pr: 2 }),
    ]);
    expect((await findings(app)).total).toBe(3);
    expect((await findings(app, "?client=acme")).total).toBe(2);
    expect((await findings(app, "?severity=minor")).items.map((i) => i.fingerprint[0])).toEqual([
      "b",
    ]);
    expect((await findings(app, "?repo=globex/portal")).total).toBe(1);
    const first = await findings(app, "?limit=1");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await findings(app, `?limit=1&cursor=${first.nextCursor ?? ""}`);
    expect(second.items[0]?.fingerprint).not.toBe(first.items[0]?.fingerprint);
  });

  it("rejects an unknown client, an unknown key and a bad filter value", async () => {
    const app = await appFor([]);
    for (const query of ["?client=nobody", "?x=1", "?severity=huge", "?repo=nonsense"]) {
      const response = await app.inject({ method: "GET", url: `/api/reviews/findings${query}` });
      expect(response.statusCode).toBe(400);
    }
  });
});
