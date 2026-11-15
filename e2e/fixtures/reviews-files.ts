/**
 * The synthetic files of the Reviews view: Control events, night log lines and sub-agent transcripts of
 * one night run of `acme/app` and `acme/site`. All times are relative to the time of the test.
 *
 * | Pull request | Issue | Final tier | Rounds | Build end                       |
 * |--------------|-------|------------|--------|---------------------------------|
 * | app 40       | 12    | authority  | 2 pass | agent span (with a split)       |
 * | app 41       | 13    | sensitive  | 1 pass | first gate event                |
 * | app 42       | 14    | sensitive  | 3 BLOCKED, no matrix | first gate event  |
 * | app 46       | none  | general    | 2 pass, a Security minor | none        |
 * | site 50      | none  | inert      | 1 pass, a Security major | none        |
 */

const MINUTE_MS = 60_000;
const APP = "acme/app";
const SITE = "acme/site";
const APP_PROJECT = `/synthetic/${APP}`;

/** The hostile ref of the scenario "Refs stay plain text". */
export const HOSTILE_REF = '<img src="https://evil.example/t.png">';

const stamp = (time: Date): string => `${time.toISOString().slice(0, 19)}Z`;
const dateOf = (time: Date): string => time.toISOString().slice(0, 10);

interface Event {
  time: Date;
  body: Record<string, unknown>;
}

const gate = (
  repo: string,
  pr: number,
  issue: number | null,
  minute: number,
  start: Date,
  over: {
    tier: string | null;
    round: number;
    decision: string;
    matrix?: Record<string, Record<string, number>>;
    refs?: string[];
  },
): Event => {
  const time = new Date(start.getTime() + minute * MINUTE_MS);
  return {
    time,
    body: {
      kind: "gate",
      repo,
      time: stamp(time),
      pr,
      issue,
      tier: over.tier,
      round: over.round,
      decision: over.decision,
      counts: {},
      categories: {},
      refs: over.refs ?? [],
      waived: [],
      ...(over.matrix === undefined ? {} : { matrix: over.matrix }),
    },
  };
};

function controlEvents(start: Date, siteEvents: boolean): Event[] {
  const at = (minute: number) => new Date(start.getTime() + minute * MINUTE_MS);
  const siteGates = [
    gate(SITE, 50, null, 75, start, {
      tier: "inert",
      round: 1,
      decision: "pass",
      matrix: { Security: { major: 1 } },
      refs: ["CWE-79"],
    }),
  ];
  return [
    ...(siteEvents ? siteGates : []),
    gate(APP, 40, 12, 50, start, {
      tier: "general",
      round: 1,
      decision: "fail",
      matrix: { Security: { major: 1, minor: 2 } },
      refs: ["CWE-639"],
    }),
    {
      time: at(55),
      body: {
        kind: "escalated",
        repo: APP,
        time: stamp(at(55)),
        pr: 40,
        issue: 12,
        path_tier: "general",
        tier: "authority",
        paths: [],
        evidence: [],
      },
    },
    gate(APP, 40, 12, 80, start, {
      tier: "authority",
      round: 2,
      decision: "pass",
      matrix: { Security: { minor: 1 } },
    }),
    gate(APP, 41, 13, 60, start, { tier: "sensitive", round: 1, decision: "pass", matrix: {} }),
    gate(APP, 42, 14, 65, start, { tier: "sensitive", round: 1, decision: "fail" }),
    gate(APP, 42, 14, 85, start, { tier: "sensitive", round: 2, decision: "fail" }),
    gate(APP, 42, 14, 105, start, { tier: "sensitive", round: 3, decision: "blocked" }),
    gate(APP, 46, null, 70, start, {
      tier: "general",
      round: 1,
      decision: "fail",
      matrix: { Testing: { minor: 1 } },
    }),
    gate(APP, 46, null, 95, start, {
      tier: "general",
      round: 2,
      decision: "pass",
      matrix: { Security: { minor: 1 } },
      refs: ["CWE-639", HOSTILE_REF],
    }),
    {
      time: at(90),
      body: {
        kind: "merged",
        repo: APP,
        time: stamp(at(90)),
        pr: 46,
        issue: null,
        base: "main",
        tier: "general",
      },
    },
    {
      time: at(91),
      body: {
        kind: "merged",
        repo: APP,
        time: stamp(at(91)),
        pr: 40,
        issue: 12,
        base: "feature/export",
        tier: "authority",
      },
    },
  ];
}

function grouped(events: Event[], folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const { time, body } of events) {
    const file = `factory/${folder}/${dateOf(time)}.jsonl`;
    files[file] = `${files[file] ?? ""}${JSON.stringify(body)}\n`;
  }
  return files;
}

const nightLine = (
  start: Date,
  issue: number,
  minute: number,
  from: string,
  to: string,
  reason: string,
  repo = APP,
): Event => {
  const time = new Date(start.getTime() + minute * MINUTE_MS);
  return {
    time,
    body: {
      run_id: "run-synthetic-reviews",
      repo: `/synthetic/${repo}`,
      issue,
      from,
      to,
      reason,
      time: stamp(time),
    },
  };
};

const BUILD = "build started";

function nightLog(start: Date, siteBuild: boolean): Event[] {
  return [
    ...(siteBuild
      ? [
          nightLine(start, 5, 0, "READY", "IN PROGRESS", BUILD, SITE),
          nightLine(start, 5, 45, "IN REVIEW", "DONE", "merged #5", SITE),
        ]
      : []),
    nightLine(start, 12, 0, "READY", "IN PROGRESS", BUILD),
    nightLine(start, 13, 5, "READY", "IN PROGRESS", BUILD),
    nightLine(start, 14, 10, "READY", "IN PROGRESS", BUILD),
    nightLine(start, 12, 90, "IN REVIEW", "DONE", "merged #40"),
    nightLine(start, 13, 100, "IN PROGRESS", "IN REVIEW", "merge-ready #41"),
    nightLine(start, 14, 120, "IN PROGRESS", "BLOCKED", "gate failed"),
  ];
}

/** The start of the night run: 5 hours before the test, in whole seconds. */
export function runStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() - 300 * MINUTE_MS) / 1000) * 1000);
}

export interface ReviewsFilesOptions {
  /** False leaves out the Control events of `acme/site`. The default is true. */
  siteEvents?: boolean;
  /** True adds one build of `acme/site`, which then has no tier and unknown rounds. */
  siteBuild?: boolean;
}

/** Control events and night log lines, and no transcript. */
export function reviewsFiles(
  now: Date,
  { siteEvents = true, siteBuild = false }: ReviewsFilesOptions = {},
): Record<string, string> {
  const start = runStart(now);
  return {
    ...grouped(controlEvents(start, siteEvents), "controls"),
    ...grouped(nightLog(start, siteBuild), "runs"),
  };
}

const folderOf = (project: string): string => project.replace(/[^A-Za-z0-9]/g, "-");

/**
 * Sub-agent transcripts of the build of issue 12: a `software-developer` span from minute 2 to 35, two
 * `review-finder` spans, a `review-verifier` span and a `review-resolver` span. They give the build end
 * "agent span" and the split of the Review cycle.
 */
export function reviewsTranscripts(now: Date): Record<string, string> {
  const start = runStart(now);
  const session = "sess-reviews-1";
  const root = `projects/${folderOf(APP_PROJECT)}`;
  const cwd = `${APP_PROJECT}.worktrees/12-add-export`;
  const files: Record<string, string> = {};
  const span = (id: string, agentType: string, minutes: number[]) => {
    files[`${root}/${session}/subagents/agent-${id}.jsonl`] = `${minutes
      .map((minute, index) =>
        JSON.stringify({
          type: "assistant",
          sessionId: session,
          timestamp: new Date(start.getTime() + minute * MINUTE_MS).toISOString(),
          cwd,
          gitBranch: "HEAD",
          message: {
            id: `${id}-${index.toString()}`,
            model: "synthetic-priced-1",
            content: [{ type: "text", text: "SYNTHETIC-REPLY-TEXT" }],
            usage: { input_tokens: 1000, output_tokens: 200 },
          },
        }),
      )
      .join("\n")}\n`;
    files[`${root}/${session}/subagents/agent-${id}.meta.json`] = JSON.stringify({
      agentType,
      toolUseId: `toolu_${id}`,
    });
  };
  span("dev", "software-developer", [2, 20, 35]);
  span("find1", "review-finder", [40, 50]);
  span("find2", "review-finder", [42, 55]);
  span("verify", "review-verifier", [55, 60]);
  span("resolve", "review-resolver", [65, 75]);
  files[`${root}/${session}.jsonl`] = `${JSON.stringify({
    type: "assistant",
    sessionId: session,
    timestamp: new Date(start.getTime() + MINUTE_MS).toISOString(),
    cwd: APP_PROJECT,
    gitBranch: "main",
    message: {
      id: "main-0",
      model: "synthetic-priced-1",
      content: [{ type: "text", text: "SYNTHETIC-REPLY-TEXT" }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    },
  })}\n`;
  return files;
}
