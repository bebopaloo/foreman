import { schema } from "@foreman/db";
import {
  WorkIssuesResponse,
  WorkPullRequestsResponse,
  WorkReleasesResponse,
} from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
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
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases`,
  );
});

const ACME_APP = repoId("github.com", "acme", "app");
const ACME_WEB = repoId("github.com", "acme", "web");
const MISC_TOOL = repoId("github.com", "misc", "tool");
const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-01-02T00:00:00Z");

const TOKENS = { "github.com/acme": "t", "github.com/misc": "t", "github.com/globex": "t" };

async function appFor(
  repos: unknown[] = [entry("acme/app", "acme"), entry("acme/web", "acme"), entry("misc/tool")],
  tokens: Record<string, string> = TOKENS,
) {
  const claudeDir = await makeClaudeDir({ repos });
  const tokensFile = await writeTokens(claudeDir, tokens);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false });
}

type App = Awaited<ReturnType<typeof appFor>>;

async function get(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function issues(app: App, url: string) {
  return WorkIssuesResponse.parse((await get(app, url)).body);
}

async function pulls(app: App, url: string) {
  return WorkPullRequestsResponse.parse((await get(app, url)).body);
}

async function releases(app: App, url: string) {
  return WorkReleasesResponse.parse((await get(app, url)).body);
}

function issueRow(
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

function pullRow(
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

const numbers = (page: { items: { repoId: string; number: number }[] }) =>
  page.items.map((item) => [item.repoId, item.number]);

describe("GET /api/work/issues", () => {
  it("shows the issues of a repo with no client only with no scope", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([issueRow(MISC_TOOL, 1), issueRow(ACME_APP, 2)]);
    const scoped = await issues(app, "/api/work/issues?client=acme");
    expect(numbers(scoped)).toEqual([[ACME_APP, 2]]);
    const all = await issues(app, "/api/work/issues");
    expect(numbers(all)).toEqual([
      [ACME_APP, 2],
      [MISC_TOOL, 1],
    ]);
    await app.close();
  });

  it("links only a url that is https, on the repo host, with no user name and no port", async () => {
    const app = await appFor();
    const urls = [
      "https://github.com/acme/app/issues/7",
      "https://evil.example/x",
      "http://github.com/acme/app/issues/8",
      "https://github.com:8443/acme/app/issues/9",
      "https://user@github.com/acme/app/issues/10",
    ];
    await database.db
      .insert(schema.workIssues)
      .values(urls.map((link, index) => issueRow(ACME_APP, 7 + index, { link })));
    const body = await issues(app, "/api/work/issues?repo=" + ACME_APP);
    const links = (body.items as { number: number; link: string | null }[])
      .sort((a, b) => a.number - b.number)
      .map((item) => item.link);
    expect(links).toEqual(["https://github.com/acme/app/issues/7", null, null, null, null]);
    await app.close();
  });

  it("returns no data for a repo of an owner with no token", async () => {
    const app = await appFor(undefined, { "github.com/misc": "t" });
    await database.db
      .insert(schema.workIssues)
      .values([issueRow(ACME_APP, 1), issueRow(MISC_TOOL, 2)]);
    const body = await issues(app, "/api/work/issues");
    expect(numbers(body)).toEqual([[MISC_TOOL, 2]]);
    const owned = await issues(app, `/api/work/issues?repo=${ACME_APP}`);
    expect(owned).toEqual({ items: [], nextCursor: null });
    await app.close();
  });

  it("returns no data when there is no tokens file", async () => {
    const app = await appFor(undefined, {});
    await database.db.insert(schema.workIssues).values(issueRow(ACME_APP, 1));
    expect((await get(app, "/api/work/issues")).body).toEqual({ items: [], nextCursor: null });
    await app.close();
  });

  it("refuses an unknown client with status 400 and no fall back to All", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values(issueRow(ACME_APP, 1));
    const { status, body } = await get(app, "/api/work/issues?client=globex");
    expect(status).toBe(400);
    expect(body).not.toHaveProperty("items");
    await app.close();
  });

  it("refuses a repo ID that is outside the client", async () => {
    const app = await appFor();
    expect((await get(app, `/api/work/issues?client=acme&repo=${MISC_TOOL}`)).status).toBe(400);
    expect((await get(app, `/api/work/issues?repo=${"0".repeat(12)}`)).status).toBe(400);
    expect((await get(app, `/api/work/issues?client=acme&repo=${ACME_WEB}`)).status).toBe(200);
    await app.close();
  });

  it("refuses an unknown query key and a limit above the maximum", async () => {
    const app = await appFor();
    expect((await get(app, "/api/work/issues?color=red")).status).toBe(400);
    expect((await get(app, "/api/work/issues?limit=501")).status).toBe(400);
    expect((await get(app, "/api/work/issues?limit=500")).status).toBe(200);
    await app.close();
  });

  it("sorts by repo ID and then by number from high to low, and pages with a cursor", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([1, 5, 3, 4, 2].map((n) => issueRow(ACME_APP, n)).concat(issueRow(ACME_WEB, 9)));
    const page1 = await issues(app, "/api/work/issues?limit=4");
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = await issues(app, `/api/work/issues?limit=4&cursor=${String(page1.nextCursor)}`);
    const all = [...numbers(page1), ...numbers(page2)];
    const [firstRepo, secondRepo] = [
      { id: ACME_APP, numbers: [5, 4, 3, 2, 1] },
      { id: ACME_WEB, numbers: [9] },
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    const expected = [firstRepo, secondRepo].flatMap((repo) =>
      (repo?.numbers ?? []).map((n) => [repo?.id, n]),
    );
    expect(all).toEqual(expected);
    expect(page2.nextCursor).toBeNull();
    await app.close();
  });

  it("refuses a cursor from another query", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values([1, 2, 3].map((n) => issueRow(ACME_APP, n)));
    const page = await issues(app, "/api/work/issues?limit=1");
    const cursor = String(page.nextCursor);
    expect((await get(app, `/api/work/issues?limit=1&client=acme&cursor=${cursor}`)).status).toBe(
      400,
    );
    expect((await get(app, "/api/work/issues?cursor=not-a-cursor")).status).toBe(400);
    await app.close();
  });

  it("filters by Issue state and by state", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issueRow(ACME_APP, 1, { issueState: "READY", state: "open" }),
        issueRow(ACME_APP, 2, { issueState: "BLOCKED", state: "open" }),
        issueRow(ACME_APP, 3, { issueState: "READY", state: "closed" }),
      ]);
    const ready = await issues(app, "/api/work/issues?issue_state=READY");
    expect(numbers(ready).map(([, n]) => n)).toEqual([3, 1]);
    const readyOpen = await issues(app, "/api/work/issues?issue_state=READY&state=open");
    expect(numbers(readyOpen).map(([, n]) => n)).toEqual([1]);
    expect((await get(app, "/api/work/issues?state=merged")).status).toBe(400);
    await app.close();
  });

  it("marks an issue that the last listing did not include as stale, with its relations", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workIssues)
      .values([
        issueRow(ACME_APP, 1, { lastListedAt: T1, parent: 9, children: [2], blockedBy: [3] }),
        issueRow(ACME_APP, 2, { lastListedAt: T0, state: "closed" }),
      ]);
    const body = await issues(app, "/api/work/issues");
    expect(body.items).toEqual([
      expect.objectContaining({
        number: 2,
        stale: true,
        relations: { parent: null, children: [], blockedBy: [] },
      }),
      expect.objectContaining({
        number: 1,
        stale: false,
        relations: { parent: 9, children: [2], blockedBy: [3] },
      }),
    ]);
    await app.close();
  });

  it("sends no field outside the response schema", async () => {
    const app = await appFor();
    await database.db.insert(schema.workIssues).values(issueRow(ACME_APP, 1));
    const body = await issues(app, "/api/work/issues");
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      [
        "author",
        "issueState",
        "labels",
        "link",
        "number",
        "priority",
        "relations",
        "repoId",
        "stale",
        "state",
        "title",
      ].sort(),
    );
    await app.close();
  });
});

describe("GET /api/work/pull-requests", () => {
  it("returns the pull requests of the client with review counts by author and state", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workPullRequests)
      .values([
        pullRow(ACME_APP, 1, { link: "https://github.com/acme/app/pull/1" }),
        pullRow(ACME_APP, 2, { link: "https://evil.example/pull/2" }),
        pullRow(MISC_TOOL, 3),
      ]);
    const review = (position: number, author: string, state: string) => ({
      repoId: ACME_APP,
      pullRequestNumber: 2,
      position,
      author,
      state,
      commit: "abc1234",
      time: T0,
    });
    await database.db
      .insert(schema.workReviews)
      .values([
        review(0, "zed", "APPROVED"),
        review(1, "amy", "CHANGES_REQUESTED"),
        review(2, "amy", "APPROVED"),
        review(3, "amy", "APPROVED"),
      ]);
    const body = await pulls(app, "/api/work/pull-requests?client=acme");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ number: 2, link: null, stale: false });
    expect(body.items[0]?.reviews).toEqual([
      { author: "amy", state: "APPROVED", count: 2 },
      { author: "amy", state: "CHANGES_REQUESTED", count: 1 },
      { author: "zed", state: "APPROVED", count: 1 },
    ]);
    expect(body.items[1]).toMatchObject({
      number: 1,
      link: "https://github.com/acme/app/pull/1",
      reviews: [],
    });
    await app.close();
  });

  it("refuses an unknown client", async () => {
    const app = await appFor();
    expect((await get(app, "/api/work/pull-requests?client=globex")).status).toBe(400);
    await app.close();
  });

  it("marks a pull request that the last listing did not include as stale", async () => {
    const app = await appFor();
    await database.db
      .insert(schema.workPullRequests)
      .values([
        pullRow(ACME_APP, 1, { lastListedAt: T0 }),
        pullRow(ACME_APP, 2, { lastListedAt: T1 }),
      ]);
    const body = await pulls(app, "/api/work/pull-requests");
    expect(
      body.items.map((item: { number: number; stale: boolean }) => [item.number, item.stale]),
    ).toEqual([
      [2, false],
      [1, true],
    ]);
    await app.close();
  });
});

describe("GET /api/work/releases", () => {
  it("returns Releases by name from high to low with the forge release of a released one", async () => {
    const app = await appFor();
    await database.db.insert(schema.workReleases).values([
      {
        repoId: ACME_APP,
        name: "v1.2.0",
        state: "released",
        link: "https://github.com/acme/app/milestone/2",
        issueNumbers: [4, 5],
      },
      {
        repoId: ACME_APP,
        name: "v1.3.0",
        state: "open",
        link: "http://github.com/acme/app/milestone/3",
        issueNumbers: [],
      },
      { repoId: MISC_TOOL, name: "v0.1.0", state: "open", link: null, issueNumbers: [] },
    ]);
    await database.db.insert(schema.workForgeReleases).values({
      repoId: ACME_APP,
      tag: "v1.2.0",
      targetCommit: "deadbeef",
      assetNames: ["app.tgz"],
      link: "https://github.com/acme/app/releases/tag/v1.2.0",
      noForgeRelease: false,
    });
    const body = await releases(app, "/api/work/releases?client=acme");
    expect(body.items).toEqual([
      {
        repoId: ACME_APP,
        name: "v1.3.0",
        state: "open",
        link: null,
        issueNumbers: [],
        forgeRelease: null,
      },
      {
        repoId: ACME_APP,
        name: "v1.2.0",
        state: "released",
        link: "https://github.com/acme/app/milestone/2",
        issueNumbers: [4, 5],
        forgeRelease: {
          tag: "v1.2.0",
          targetCommit: "deadbeef",
          assetNames: ["app.tgz"],
          link: "https://github.com/acme/app/releases/tag/v1.2.0",
          noForgeRelease: false,
        },
      },
    ]);
    const all = await releases(app, "/api/work/releases");
    expect(all.items).toHaveLength(3);
    await app.close();
  });

  it("returns no Release of a repo with no token", async () => {
    const app = await appFor(undefined, { "github.com/misc": "t" });
    await database.db
      .insert(schema.workReleases)
      .values({ repoId: ACME_APP, name: "v1.0.0", state: "open", link: null, issueNumbers: [] });
    expect((await get(app, "/api/work/releases")).body).toEqual({ items: [], nextCursor: null });
    await app.close();
  });

  it("pages Releases with a cursor", async () => {
    const app = await appFor();
    await database.db.insert(schema.workReleases).values(
      ["v1.0.0", "v1.1.0", "v1.2.0"].map((name) => ({
        repoId: ACME_APP,
        name,
        state: "open",
        link: null,
        issueNumbers: [],
      })),
    );
    const page1 = await releases(app, "/api/work/releases?limit=2");
    expect(page1.items.map((item: { name: string }) => item.name)).toEqual(["v1.2.0", "v1.1.0"]);
    const page2 = await releases(
      app,
      `/api/work/releases?limit=2&cursor=${String(page1.nextCursor)}`,
    );
    expect(page2.items.map((item: { name: string }) => item.name)).toEqual(["v1.0.0"]);
    expect(page2.nextCursor).toBeNull();
    await app.close();
  });
});
