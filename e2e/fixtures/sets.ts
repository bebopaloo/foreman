import type { WorkSeed } from "./work-seed.ts";

/** A fixture set: the files of a synthetic Claude folder and the Work cache. All data is synthetic. */
export interface FixtureSet {
  /** The files below the Claude folder, by relative path. `now` is the time of the test. */
  files(now: Date): Record<string, string>;
  /** The Work cache. With none, the cache is empty. */
  work?: WorkSeed;
}

const MINUTE_MS = 60_000;

const REPOS = [
  { repo: "acme/app", client: "acme" },
  { repo: "acme/site", client: "acme" },
  { repo: "bebopaloo/tools", client: "bebopaloo" },
  { repo: "misc/notes", client: null },
] as const;

export const repoFolder = (repo: string): string => `/synthetic/${repo}`;

/** The repo list: two repos of `acme`, one of `bebopaloo` and one with no client. */
function repoList(): string {
  return JSON.stringify({
    repos: REPOS.map(({ repo, client }) => ({
      path: repoFolder(repo),
      forge: "factory-github",
      tracker: "factory-github",
      enabled: true,
      repo,
      host: "github.com",
      ...(client === null ? {} : { client }),
    })),
  });
}

/** The cache of connected repos, with a few open issues and one pull request. */
const CONNECTED_CACHE: WorkSeed = {
  repos: REPOS.map(({ repo, client }) => ({ fullName: repo, client })),
  issues: [
    { repo: "acme/app", number: 11, title: "Add the export", issueState: "IN PROGRESS" },
    { repo: "acme/app", number: 12, title: "Fix the sort order", issueState: "READY" },
    { repo: "bebopaloo/tools", number: 3, title: "Write the guide", issueState: "TODO" },
  ],
  pullRequests: [{ repo: "acme/app", number: 40, title: "Add the export" }],
};

export interface NightLogLine {
  run_id: string;
  repo: string;
  issue: number;
  from: string;
  to: string;
  reason: string;
  time: Date;
}

const stamp = (time: Date): string => `${time.toISOString().slice(0, 19)}Z`;

/** The night log files of some lines: one file for each UTC date. */
function nightLog(lines: NightLogLine[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const line of lines) {
    const file = `factory/runs/${line.time.toISOString().slice(0, 10)}.jsonl`;
    files[file] = `${files[file] ?? ""}${JSON.stringify({ ...line, time: stamp(line.time) })}\n`;
  }
  return files;
}

function runLock(runId: string, heartbeat: Date): Record<string, string> {
  return {
    "factory/run.lock": JSON.stringify({ run_id: runId, heartbeat: heartbeat.getTime() / 1000 }),
  };
}

/** Three builds of `acme/app` that started, and none that ended. */
function threeBuilds(now: Date): NightLogLine[] {
  return [11, 12, 13].map((issue, index) => ({
    run_id: "run-synthetic-1",
    repo: repoFolder("acme/app"),
    issue,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: new Date(now.getTime() - (90 - index * 10) * MINUTE_MS),
  }));
}

export const FIXTURE_SETS = {
  /** No repo list and no factory folder: Foreman has no client and no data. */
  empty: { files: () => ({}) },

  /** The repo list and a connected Work cache; no night log and no run lock. */
  "no-run": { files: () => ({ "factory/repos.json": repoList() }), work: CONNECTED_CACHE },

  "run-in-progress": {
    files: (now) => ({
      "factory/repos.json": repoList(),
      ...runLock("run-synthetic-1", new Date(now.getTime() - 4 * MINUTE_MS)),
      ...nightLog(threeBuilds(now)),
    }),
    work: CONNECTED_CACHE,
  },

  "stale-lock": {
    files: (now) => ({
      "factory/repos.json": repoList(),
      ...runLock("run-synthetic-1", new Date(now.getTime() - 200 * MINUTE_MS)),
      ...nightLog(threeBuilds(now)),
    }),
    work: CONNECTED_CACHE,
  },

  "unreadable-lock": {
    files: () => ({ "factory/repos.json": repoList(), "factory/run.lock": "{not json" }),
    work: CONNECTED_CACHE,
  },

  /** One bad night log line, a last line with no line end, and one Control event of an unknown kind. */
  "malformed-lines": {
    files: (now) => {
      const time = new Date(now.getTime() - 10 * MINUTE_MS);
      const good = {
        run_id: "run-synthetic-1",
        repo: repoFolder("acme/app"),
        issue: 11,
        from: "READY",
        to: "IN PROGRESS",
        reason: "build started",
        time: stamp(time),
      };
      const event = { kind: "surprise", repo: "acme/app", time: stamp(time) };
      return {
        "factory/repos.json": repoList(),
        [`factory/runs/${time.toISOString().slice(0, 10)}.jsonl`]: `${JSON.stringify(good)}\n{not json}\n{"run_id":"cut`,
        [`factory/controls/${time.toISOString().slice(0, 10)}.jsonl`]: `${JSON.stringify(event)}\n`,
      };
    },
    work: CONNECTED_CACHE,
  },

  /** The repo list names the repos, but the Work cache has no rows: no token. */
  "not-connected": {
    files: () => ({ "factory/repos.json": repoList() }),
    work: {
      repos: REPOS.map(({ repo, client }) => ({
        fullName: repo,
        client,
        state: "not connected: no token",
      })),
    },
  },
} as const satisfies Record<string, FixtureSet>;

export type FixtureName = keyof typeof FIXTURE_SETS;
