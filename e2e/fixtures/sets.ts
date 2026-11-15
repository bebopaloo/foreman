import type { WorkSeed } from "./work-seed.ts";

/** A fixture set: the files of a synthetic Claude folder and the Work cache. All data is synthetic. */
export interface FixtureSet {
  /** The files below the Claude folder, by relative path. `now` is the time of the test. */
  files(now: Date): Record<string, string>;
  /** The Work cache. With none, the cache is empty. */
  work?: WorkSeed;
  /** The owners (`host/owner`) that have a token in the tokens file. With none, no owner has a token. */
  tokenOwners?: readonly string[];
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
const SITE = "acme/site";

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

const FACTORY = "synthetic-factory[bot]";

const controlFile = (time: Date): string =>
  `factory/controls/${time.toISOString().slice(0, 10)}.jsonl`;

/** The Control events of 10 pull requests of 2 repos, 3 escalations and 3 uses of the Waiver `W-1`. */
function controlLines(now: Date): string {
  const time = stamp(new Date(now.getTime() - 20 * MINUTE_MS));
  const gate = (repo: string, pr: number, tier: string | null, round: number, decision: string) =>
    JSON.stringify({
      kind: "gate",
      repo,
      time,
      pr,
      issue: null,
      tier,
      round,
      decision,
      counts: {},
      categories: [],
      refs: [],
      waived: [],
      ...(pr % 2 === 0 ? { matrix: {} } : {}),
    });
  const escalated = (repo: string, pr: number) =>
    JSON.stringify({
      kind: "escalated",
      repo,
      time,
      pr,
      issue: null,
      path_tier: "general",
      tier: "sensitive",
      paths: [],
      evidence: [],
    });
  const waiver = (repo: string, pr: number) =>
    JSON.stringify({ kind: "waiver_used", repo, time, pr, waiver: "W-1", finding: "f" });
  return `${[
    gate(APP, 1, "general", 1, "pass"),
    gate(APP, 2, "general", 1, "pass"),
    gate(APP, 3, "general", 1, "fail"),
    gate(APP, 3, "general", 2, "pass"),
    gate(APP, 4, "sensitive", 1, "pass"),
    gate(APP, 5, "sensitive", 1, "fail"),
    gate(APP, 5, "sensitive", 2, "fail"),
    gate(APP, 5, "sensitive", 3, "blocked"),
    gate(SITE, 1, null, 1, "pass"),
    gate(SITE, 1, null, 1, "wait"),
    gate(SITE, 2, null, 1, "fail"),
    gate(SITE, 3, "general", 1, "pass"),
    gate(SITE, 4, "general", 1, "pass"),
    gate(SITE, 5, "general", 1, "pass"),
    escalated(APP, 1),
    escalated(APP, 2),
    escalated(SITE, 1),
    waiver(APP, 1),
    waiver(APP, 2),
    waiver(SITE, 1),
  ].join("\n")}\n`;
}

/**
 * Review health: Control events for `acme/app` and `acme/site`, and no event for `bebopaloo/tools`,
 * which has 4 pull requests of the Factory identity (3 reviewed by it) and 1 of the Operator.
 */
const REVIEW_HEALTH_CACHE: WorkSeed = {
  ...CONNECTED_CACHE,
  pullRequests: [
    ...(CONNECTED_CACHE.pullRequests ?? []),
    ...[1, 2, 3, 4].map((number) => ({
      repo: TOOLS,
      number,
      title: `Factory change ${number.toString()}`,
      author: FACTORY,
    })),
    { repo: TOOLS, number: 5, title: "Operator change", author: "synthetic-operator" },
  ],
  reviews: [
    { repo: TOOLS, pullRequest: 1, author: FACTORY },
    { repo: TOOLS, pullRequest: 2, author: "synthetic-operator" },
    { repo: TOOLS, pullRequest: 2, author: FACTORY },
    { repo: TOOLS, pullRequest: 3, author: FACTORY },
    { repo: TOOLS, pullRequest: 5, author: FACTORY },
  ],
};

/** Owners with a synthetic token in the e2e tokens file. The API reads only repos of such owners. */
const OWNERS = ["github.com/acme", "github.com/bebopaloo"] as const;

const SHA_A = "a".repeat(40);

/** A `gate` Control event of one pull request. */
const gateEvent = (repo: string, pr: number, round: number, decision: string, time: string) =>
  JSON.stringify({
    kind: "gate",
    repo,
    time,
    pr,
    issue: null,
    tier: "sensitive",
    round,
    decision,
    counts: {},
    categories: [],
    refs: [],
    waived: [],
  });

/**
 * The Work view: `acme/app` has an issue with its pull request, an issue with none, a stale closed
 * issue, an issue with a title of markup and no link, and a pull request with no issue. `acme/site` has
 * a BLOCKED issue. `bebopaloo/tools` has one TODO issue. `misc/notes` has no token. Only `acme/app` has
 * Control events.
 */
const WORK_CACHE: WorkSeed = {
  repos: REPOS.map(({ repo, client }) =>
    repo === "misc/notes"
      ? { fullName: repo, client, state: "not connected: no token" }
      : { fullName: repo, client },
  ),
  issues: [
    {
      repo: APP,
      number: 12,
      title: "Add the export",
      issueState: "IN REVIEW",
      priority: "high",
      labels: ["type:feature"],
    },
    { repo: APP, number: 15, title: "Fix the sort order", issueState: "READY", priority: "low" },
    {
      repo: APP,
      number: 16,
      title: "Remove the old flag",
      issueState: "TODO",
      state: "closed",
      stale: true,
    },
    {
      repo: APP,
      number: 17,
      title: '<img src="https://evil.example/t.png"> **Fix** [this](https://evil.example)',
      issueState: "READY",
      link: null,
    },
    {
      repo: SITE,
      number: 1,
      title: "Update the footer",
      issueState: "BLOCKED",
      labels: ["type:fix"],
    },
    { repo: TOOLS, number: 3, title: "Write the guide", issueState: "TODO" },
  ],
  pullRequests: [
    {
      repo: APP,
      number: 40,
      title: "Add the export",
      head: "12-add-the-export",
      labels: ["risk:sensitive"],
      headSha: SHA_A,
      linkedIssue: 12,
    },
    { repo: APP, number: 50, title: "Release 1.2", head: "release/1.2" },
  ],
  statuses: [
    {
      repo: APP,
      pullRequest: 40,
      context: "factory/machine-gate",
      sha: SHA_A,
      state: "pass",
    },
  ],
};

/** 230 open issues of `acme/app`: two full pages of 100 and a page of 30. */
const MANY_ISSUES_CACHE: WorkSeed = {
  repos: REPOS.map(({ repo, client }) => ({ fullName: repo, client })),
  issues: Array.from({ length: 230 }, (_, index) => ({
    repo: APP,
    number: index + 1,
    title: `Synthetic issue ${(index + 1).toString()}`,
    issueState: "READY",
  })),
};

export const FIXTURE_SETS = {
  work: {
    files: (now) => {
      const time = stamp(new Date(now.getTime() - 20 * MINUTE_MS));
      return {
        "factory/repos.json": repoList(),
        [controlFile(new Date(now.getTime() - 20 * MINUTE_MS))]: `${[
          gateEvent(APP, 40, 1, "fail", time),
          gateEvent(APP, 40, 2, "pass", time),
        ].join("\n")}\n`,
      };
    },
    work: WORK_CACHE,
    tokenOwners: OWNERS,
  },

  /** 230 rows for Show more. */
  "work-many": {
    files: () => ({ "factory/repos.json": repoList() }),
    work: MANY_ISSUES_CACHE,
    tokenOwners: OWNERS,
  },

  /** Review health: Control events of 2 repos, and one connected repo with none. */
  "review-health": {
    files: (now) => ({
      "factory/repos.json": repoList(),
      [controlFile(new Date(now.getTime() - 20 * MINUTE_MS))]: controlLines(now),
    }),
    work: REVIEW_HEALTH_CACHE,
  },

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
