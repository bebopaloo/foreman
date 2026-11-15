import type { WorkSeed } from "./work-seed.ts";

/** A fixture set: the files of a synthetic Claude folder and the Work cache. All data is synthetic. */
export interface FixtureSet {
  /** The files below the Claude folder, by relative path. `now` is the time of the test. */
  files(now: Date): Record<string, string>;
  /** The Work cache. With none, the cache is empty. */
  work?: WorkSeed;
  /** True when the set holds transcripts: the Usage index is cleared and read again for it. */
  usage?: boolean;
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

const HOUR_MS = 60 * MINUTE_MS;

interface Step {
  repo: string;
  issue: number;
  from: string;
  to: string;
  reason: string;
  /** Minutes after the start of the run. */
  at: number;
}

const START = "IN PROGRESS";
const step = (
  repo: string,
  issue: number,
  at: number,
  to: string,
  reason: string,
  from = START,
) => ({
  repo,
  issue,
  from,
  to,
  reason,
  at,
});

function runLines(runId: string, start: Date, steps: Step[]): NightLogLine[] {
  return steps.map(({ repo, at, ...rest }) => ({
    run_id: runId,
    repo: repoFolder(repo),
    ...rest,
    time: new Date(start.getTime() + at * MINUTE_MS),
  }));
}

const APP = "acme/app";
const TOOLS = "bebopaloo/tools";

/** The slot timeline: builds A to D, 9 skips, one issue blocked at selection and one parent issue. */
function lastRunLines(now: Date): NightLogLine[] {
  const start = new Date(now.getTime() - 8 * HOUR_MS);
  return runLines("run-synthetic-2", start, [
    step(APP, 21, 0, START, "build started", "READY"),
    step(APP, 22, 10, START, "build started", "READY"),
    step(APP, 24, 20, START, "build started", "READY"),
    step(APP, 30, 25, START, "build started", "READY"),
    ...Array.from({ length: 9 }, (_, index) =>
      step(APP, 40 + index, 40, "READY", "blocked by #3", "READY"),
    ),
    step(APP, 15, 45, "BLOCKED", "no token", "READY"),
    step(APP, 21, 120, "DONE", "merged #50", "IN REVIEW"),
    step(APP, 23, 150, START, "build started", "READY"),
    step(APP, 22, 180, "IN REVIEW", "merge-ready #51"),
    step(APP, 23, 240, "BLOCKED", "gate failed"),
  ]);
}

/** An older run of `acme` and `bebopaloo` builds, and a newer run of `bebopaloo` builds only. */
function clientRunLines(now: Date): NightLogLine[] {
  const older = new Date(now.getTime() - 30 * HOUR_MS);
  const newer = new Date(now.getTime() - 6 * HOUR_MS);
  return [
    ...runLines("run-synthetic-old", older, [
      step(TOOLS, 3, 0, START, "build started", "READY"),
      step(APP, 11, 10, START, "build started", "READY"),
      step(TOOLS, 4, 20, START, "build started", "READY"),
      step(APP, 12, 30, START, "build started", "READY"),
      step(TOOLS, 3, 150, "DONE", "merged #7", "IN REVIEW"),
      step(TOOLS, 4, 150, "DONE", "merged #8", "IN REVIEW"),
      step(APP, 11, 100, "DONE", "merged #9", "IN REVIEW"),
      step(APP, 12, 120, "DONE", "merged #10", "IN REVIEW"),
    ]),
    ...runLines("run-synthetic-new", newer, [
      step(TOOLS, 3, 0, START, "build started", "READY"),
      step(TOOLS, 3, 60, "DONE", "merged #11", "IN REVIEW"),
    ]),
  ];
}

const DAY_MS = 24 * HOUR_MS;

interface SyntheticTurn {
  project: string;
  model: string;
  /** Whole days before `now`. */
  daysAgo: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** One transcript file for each project: only the fields that the Usage index reads. */
function transcripts(now: Date, turns: SyntheticTurn[]): Record<string, string> {
  const files: Record<string, string> = {};
  turns.forEach((turn, index) => {
    const folder = turn.project.replace(/[^A-Za-z0-9]/g, "-");
    const file = `projects/${folder}/session-${folder}.jsonl`;
    const line = JSON.stringify({
      type: "assistant",
      sessionId: `session-${folder}`,
      timestamp: new Date(now.getTime() - turn.daysAgo * DAY_MS).toISOString(),
      cwd: turn.project,
      gitBranch: "main",
      message: {
        id: `msg-${index.toString()}`,
        model: turn.model,
        usage: {
          input_tokens: turn.input,
          output_tokens: turn.output,
          cache_creation_input_tokens: turn.cacheWrite,
          cache_read_input_tokens: turn.cacheRead,
        },
      },
    });
    files[file] = `${files[file] ?? ""}${line}\n`;
  });
  return files;
}

const PRICED = "synthetic-priced-1";
const UNPRICED = "synthetic-model-x";
const APP_PROJECT = repoFolder("acme/app");
const TOOLS_PROJECT = repoFolder("bebopaloo/tools");
const SPIKE_PROJECT = "/synthetic/spike-cli";

const turn = (
  project: string,
  model: string,
  daysAgo: number,
  [input, output, cacheWrite, cacheRead]: [number, number, number, number],
): SyntheticTurn => ({ project, model, daysAgo, input, output, cacheWrite, cacheRead });

/**
 * Usage in the last 14 days: 8M tokens in `acme/app`, 3M in `bebopaloo/tools` and 0.4M in a project
 * that no repo list entry matches, which also has 2 turns of a model with no price. One turn of
 * `acme/app` is 20 days old: it shows in the range of 30 days and not in the range of 14 days.
 */
function usageTurns(): SyntheticTurn[] {
  const acme: [number, number, number, number] = [300_000, 100_000, 200_000, 1_400_000];
  const tools: [number, number, number, number] = [250_000, 50_000, 200_000, 1_000_000];
  const spike: [number, number, number, number] = [50_000, 10_000, 40_000, 100_000];
  return [
    ...[1, 2, 5, 9].map((day) => turn(APP_PROJECT, PRICED, day, acme)),
    ...[3, 6].map((day) => turn(TOOLS_PROJECT, PRICED, day, tools)),
    ...[2, 7].map((day) => turn(SPIKE_PROJECT, UNPRICED, day, spike)),
    turn(APP_PROJECT, PRICED, 20, [100_000, 0, 0, 0]),
  ];
}

export const FIXTURE_SETS = {
  /** The repo list and transcripts of three projects, with a price for one model. */
  usage: {
    files: (now) => ({ "factory/repos.json": repoList(), ...transcripts(now, usageTurns()) }),
    work: CONNECTED_CACHE,
    usage: true,
  },

  /** The repo list and no transcript: the Usage index is empty. */
  "usage-empty": {
    files: () => ({ "factory/repos.json": repoList() }),
    work: CONNECTED_CACHE,
    usage: true,
  },

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

  "last-run": {
    files: (now) => ({
      "factory/repos.json": repoList(),
      ...nightLog(lastRunLines(now)),
    }),
    work: {
      ...CONNECTED_CACHE,
      issues: [
        ...(CONNECTED_CACHE.issues ?? []),
        { repo: APP, number: 30, title: "A parent", issueState: "IN PROGRESS", children: [31] },
      ],
    },
  },

  "last-run-clients": {
    files: (now) => ({
      "factory/repos.json": repoList(),
      ...nightLog(clientRunLines(now)),
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
