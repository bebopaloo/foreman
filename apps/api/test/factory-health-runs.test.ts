import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import type { FactoryRunsResponse } from "@foreman/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import {
  makeFactoryDir,
  minutesAgo,
  nightLine,
  NOW,
  writeJsonl,
  writeLock,
} from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.db.delete(schema.workIssues);
});

afterAll(async () => {
  await database.db.delete(schema.workIssues);
  await database.close();
});

const APP = "/synthetic/acme/app";
const GLOBEX = "/synthetic/globex/portal";
const REPO_LIST = {
  repos: [
    { path: APP, repo: "acme/app", client: "acme" },
    { path: GLOBEX, repo: "globex/portal", client: "globex" },
  ],
};

const at = (day: string, clock: string): string => `${day}T${clock}:00Z`;

interface Line {
  run: string;
  day: string;
  clock: string;
  issue: number;
  from?: string;
  to?: string;
  reason?: string;
  repo?: string;
}

function line(over: Line): Record<string, unknown> {
  return nightLine({
    run_id: over.run,
    repo: over.repo ?? APP,
    issue: over.issue,
    from: over.from ?? "READY",
    to: over.to ?? "IN PROGRESS",
    reason: over.reason ?? "build started",
    time: at(over.day, over.clock),
  });
}

/** A build that starts and ends: IN PROGRESS, then merged. */
function build(run: string, day: string, issue: number, start: string, end: string, repo = APP) {
  return [
    line({ run, day, clock: start, issue, repo }),
    line({
      run,
      day,
      clock: end,
      issue,
      repo,
      from: "IN REVIEW",
      to: "DONE",
      reason: "merged into main",
    }),
  ];
}

interface Setup {
  lines?: Record<string, unknown>[];
  byDay?: Record<string, (Record<string, unknown> | string)[]>;
  lock?: unknown;
  issues?: { number: number; title: string; link: string | null }[];
  noRunsFolder?: boolean;
}

async function get(setup: Setup, query = "") {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeFile(path.join(factory, "repos.json"), JSON.stringify(REPO_LIST));
  if (setup.lines !== undefined) await writeJsonl(factory, "runs", "2026-11-14", setup.lines);
  for (const [day, lines] of Object.entries(setup.byDay ?? {})) {
    await writeJsonl(factory, "runs", day, lines);
  }
  if (setup.lock !== undefined) await writeLock(factory, setup.lock);
  for (const issue of setup.issues ?? []) {
    await database.db.insert(schema.workIssues).values({
      repoId: repoId("github.com", "acme", "app"),
      number: issue.number,
      title: issue.title,
      state: "open",
      issueState: "IN PROGRESS",
      priority: "medium",
      author: "synthetic-author",
      link: issue.link,
      lastListedAt: NOW,
    });
  }
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
    db: database.db,
    logger: false,
    now: () => NOW,
  });
  const response = await app.inject({ method: "GET", url: `/api/factory-health/runs${query}` });
  await app.close();
  return { response, claudeDir, factory, body: response.json<FactoryRunsResponse>() };
}

describe("GET /api/factory-health/runs", () => {
  it("lists the runs newest first with the results and the peak of each", async () => {
    const a = [
      ...build("run-a", "2026-11-13", 1, "01:00", "02:00"),
      ...build("run-a", "2026-11-13", 2, "01:00", "02:30"),
      ...build("run-a", "2026-11-13", 3, "01:10", "05:41"),
      ...build("run-a", "2026-11-13", 4, "01:20", "05:00"),
      line({ run: "run-a", day: "2026-11-13", clock: "02:40", issue: 5 }),
      line({
        run: "run-a",
        day: "2026-11-13",
        clock: "05:00",
        issue: 5,
        from: "IN PROGRESS",
        to: "BLOCKED",
        reason: "blocked by a failing check",
      }),
    ];
    const b = build("run-b", "2026-11-12", 20, "01:00", "03:12");
    const c = build("run-c", "2026-11-14", 30, "01:00", "06:58");
    const { response, body } = await get({
      byDay: { "2026-11-12": b, "2026-11-13": a, "2026-11-14": c },
    });
    expect(response.statusCode).toBe(200);
    expect(body.items.map((row) => row.runId)).toEqual(["run-c", "run-a", "run-b"]);
    const row = body.items[1];
    expect(row).toMatchObject({
      start: "2026-11-13T01:00:00.000Z",
      end: "2026-11-13T05:41:00.000Z",
      running: false,
      builds: 5,
      peak: 4,
      slotLimit: 5,
      skips: 0,
      blockedAtSelection: 0,
    });
    expect(row?.results).toMatchObject({ merged: 4, blocked: 1, running: 0 });
    expect(body.nextCursor).toBeNull();
    expect(body.sources).toEqual({ runs: "ok" });
  });

  it("marks stopped items as resumed by a later run or not resumed yet", async () => {
    const a = [
      line({ run: "run-a", day: "2026-11-13", clock: "01:00", issue: 12 }),
      line({ run: "run-a", day: "2026-11-13", clock: "01:05", issue: 14 }),
      line({
        run: "run-a",
        day: "2026-11-13",
        clock: "01:50",
        issue: 14,
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "pull request opened",
      }),
      line({ run: "run-a", day: "2026-11-13", clock: "02:00", issue: 16, repo: GLOBEX }),
    ];
    const b = [
      line({
        run: "run-b",
        day: "2026-11-14",
        clock: "01:30",
        issue: 12,
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "merge-ready",
      }),
    ];
    const { body } = await get({
      byDay: { "2026-11-13": a, "2026-11-14": b },
      issues: [
        {
          number: 12,
          title: "Add a <b>route</b>",
          link: "https://example.test/acme/app/issues/12",
        },
        { number: 14, title: "Fix a thing", link: "javascript:alert(1)" },
      ],
    });
    const run = body.items.find((row) => row.runId === "run-a");
    expect(run?.stoppedItems).toEqual([
      {
        repoId: repoId("github.com", "acme", "app"),
        repo: "acme/app",
        issue: 12,
        result: "stopped at run end",
        title: "Add a <b>route</b>",
        link: "https://example.test/acme/app/issues/12",
        resumedBy: "2026-11-14T01:30:00.000Z",
      },
      {
        repoId: repoId("github.com", "acme", "app"),
        repo: "acme/app",
        issue: 14,
        result: "in review",
        title: "Fix a thing",
        link: null,
        resumedBy: null,
      },
      expect.objectContaining({ repo: "globex/portal", issue: 16, title: null, resumedBy: null }),
    ]);
  });

  it("shows a run in progress with its window to now and no stopped items", async () => {
    const lines = [
      line({ run: "run-p", day: "2026-11-15", clock: "10:00", issue: 1 }),
      line({ run: "run-p", day: "2026-11-15", clock: "10:05", issue: 2 }),
      line({ run: "run-p", day: "2026-11-15", clock: "10:10", issue: 3 }),
    ];
    const { body } = await get({
      byDay: { "2026-11-15": lines },
      lock: { run_id: "run-p", heartbeat: minutesAgo(4).getTime() / 1000 },
    });
    const [row] = body.items;
    expect(row).toMatchObject({
      running: true,
      end: NOW.toISOString(),
      builds: 3,
      stoppedItems: [],
    });
    expect(row?.results.running).toBe(3);
  });

  it("shows only the lines of the client, with no slot limit", async () => {
    const first = [
      ...build("run-1", "2026-11-13", 1, "01:00", "03:00"),
      ...build("run-1", "2026-11-13", 2, "01:10", "03:00"),
      ...build("run-1", "2026-11-13", 3, "01:20", "03:00"),
      ...build("run-1", "2026-11-13", 4, "01:30", "03:00", GLOBEX),
      ...build("run-1", "2026-11-13", 5, "01:40", "03:00", GLOBEX),
    ];
    const newer = build("run-2", "2026-11-14", 9, "01:00", "02:00", GLOBEX);
    const { body } = await get(
      { byDay: { "2026-11-13": first, "2026-11-14": newer } },
      "?client=acme",
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      runId: "run-1",
      builds: 3,
      peak: 3,
      slotLimit: null,
      start: "2026-11-13T01:00:00.000Z",
      end: "2026-11-13T03:00:00.000Z",
    });
  });

  it("shows two runs that start on the same night as two rows", async () => {
    const { body } = await get({
      byDay: {
        "2026-11-13": [
          ...build("run-x", "2026-11-13", 1, "01:00", "02:00"),
          ...build("run-y", "2026-11-13", 2, "03:00", "04:00"),
        ],
      },
    });
    expect(body.items.map((row) => row.runId)).toEqual(["run-y", "run-x"]);
  });

  it("shows one row for a run that crosses midnight UTC", async () => {
    const { body } = await get({
      byDay: {
        "2026-11-13": [line({ run: "run-m", day: "2026-11-13", clock: "23:30", issue: 1 })],
        "2026-11-14": [
          line({
            run: "run-m",
            day: "2026-11-14",
            clock: "00:40",
            issue: 1,
            from: "IN REVIEW",
            to: "DONE",
            reason: "merged into main",
          }),
        ],
      },
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      start: "2026-11-13T23:30:00.000Z",
      end: "2026-11-14T00:40:00.000Z",
      builds: 1,
    });
  });

  it("counts skips and blocked at selection apart from the builds", async () => {
    const lines = [
      ...Array.from({ length: 9 }, (_, index) =>
        line({
          run: "run-s",
          day: "2026-11-14",
          clock: "01:00",
          issue: 100 + index,
          to: "READY",
          reason: "skipped",
        }),
      ),
      line({
        run: "run-s",
        day: "2026-11-14",
        clock: "01:01",
        issue: 15,
        to: "BLOCKED",
        reason: "blocked at selection",
      }),
    ];
    const { body } = await get({ byDay: { "2026-11-14": lines } });
    expect(body.items[0]).toMatchObject({ skips: 9, blockedAtSelection: 1, builds: 0, peak: 0 });
  });

  it("shows no row with no line in the window", async () => {
    const { response, body } = await get({});
    expect(response.statusCode).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.sources.runs).toBe("missing");
  });

  it("pages 45 runs with the default limit of 30", async () => {
    const byDay: Record<string, Record<string, unknown>[]> = {};
    for (let index = 0; index < 45; index += 1) {
      const day = new Date(Date.UTC(2026, 10, 1 + Math.floor(index / 4)))
        .toISOString()
        .slice(0, 10);
      const hour = (1 + (index % 4) * 3).toString().padStart(2, "0");
      byDay[day] = [
        ...(byDay[day] ?? []),
        ...build(
          `run-${index.toString().padStart(2, "0")}`,
          day,
          index + 1,
          `${hour}:00`,
          `${hour}:30`,
        ),
      ];
    }
    const { claudeDir } = await get({ byDay });
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
      now: () => NOW,
    });
    const first = (
      await app.inject({ method: "GET", url: "/api/factory-health/runs" })
    ).json<FactoryRunsResponse>();
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await app.inject({
        method: "GET",
        url: `/api/factory-health/runs?cursor=${first.nextCursor ?? ""}`,
      })
    ).json<FactoryRunsResponse>();
    await app.close();
    const ids = [...first.items, ...second.items].map((row) => row.runId);
    expect(new Set(ids).size).toBe(45);
    expect(first.items[0]?.runId).toBe("run-44");
    expect(second.items).toHaveLength(15);
    expect(second.nextCursor).toBeNull();
  });

  it("uses the valid lines and counts the skipped lines", async () => {
    const { body } = await get({
      byDay: {
        "2026-11-14": [
          ...build("run-ok", "2026-11-14", 1, "01:00", "02:00"),
          "not json",
          JSON.stringify({ run_id: "x" }),
        ],
      },
    });
    expect(body.items).toHaveLength(1);
    expect(body.skipped.nightLogLines).toBe(2);
  });

  it("reports a runs folder that it cannot read", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(
      factory,
      "runs",
      "2026-11-14",
      build("run-ok", "2026-11-14", 1, "01:00", "02:00"),
    );
    await chmod(path.join(factory, "runs"), 0o000);
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
      now: () => NOW,
    });
    const response = await app.inject({ method: "GET", url: "/api/factory-health/runs" });
    await app.close();
    await chmod(path.join(factory, "runs"), 0o700);
    expect(response.json<FactoryRunsResponse>()).toMatchObject({
      items: [],
      sources: { runs: "unreadable" },
    });
  });

  it("gets status 400 for a repo, an unknown query key and a client that is not a name", async () => {
    for (const query of [
      "?repo=github.com/acme/app",
      "?foo=1",
      "?client=Bad%20Name",
      "?limit=101",
    ]) {
      const { response } = await get({}, query);
      expect(response.statusCode, query).toBe(400);
    }
  });

  it("holds no local path in the response", async () => {
    const { response } = await get({
      byDay: { "2026-11-14": build("run-ok", "2026-11-14", 1, "01:00", "02:00") },
    });
    expect(response.body).not.toContain("/synthetic");
  });
});
