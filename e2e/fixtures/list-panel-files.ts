import type { WorkSeed } from "./work-seed.ts";

/**
 * The synthetic data of the List panel end-to-end tests: the builds of one run, the Control events of
 * `acme/app` and `acme/site`, and a Work cache for them. Times are relative to the time of the test.
 *
 * Builds of `run-panel-1` (minutes after the start of the run):
 *
 * | Build | Repo            | Start | End | Result      |
 * |-------|-----------------|-------|-----|-------------|
 * | A     | acme/app #21    | 0     | 120 | merged      |
 * | S     | scratch #7      | 5     | 30  | blocked     |
 * | B     | acme/app #22    | 10    | 180 | merge-ready |
 * | D     | acme/app #24    | 20    | 240 | stopped     |
 * | E     | acme/app #25    | 60    | 90  | merged      |
 * | C     | acme/app #23    | 150   | 240 | blocked     |
 *
 * `scratch` is a repo folder that is not in the repo list.
 */

const APP = "acme/app";
const SITE = "acme/site";
const TOOLS = "bebopaloo/tools";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A title with markup: the page must show it as text. */
export const PANEL_HOSTILE_TITLE =
  '<img src="https://evil.test/p.png"> **bold** [a](https://evil.test)';

const stamp = (time: Date): string => `${time.toISOString().slice(0, 19)}Z`;
const folder = (repo: string): string => `/synthetic/${repo}`;
const dayFile = (directory: string, time: Date): string =>
  `factory/${directory}/${time.toISOString().slice(0, 10)}.jsonl`;

export interface PanelLine {
  runId: string;
  repo: string;
  issue: number;
  from: string;
  to: string;
  reason: string;
  time: Date;
}

/** The night log files of some lines: one file for each UTC date. */
export function nightLogFiles(lines: readonly PanelLine[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const line of lines) {
    const file = dayFile("runs", line.time);
    const text = JSON.stringify({
      run_id: line.runId,
      repo: folder(line.repo),
      issue: line.issue,
      from: line.from,
      to: line.to,
      reason: line.reason,
      time: stamp(line.time),
    });
    files[file] = `${files[file] ?? ""}${text}\n`;
  }
  return files;
}

/** The lines of `run-panel-1`. */
export function runOneLines(now: Date): PanelLine[] {
  const start = now.getTime() - 8 * HOUR_MS;
  const at = (minutes: number) => new Date(start + minutes * MINUTE_MS);
  const begin = (repo: string, issue: number, minutes: number): PanelLine => ({
    runId: "run-panel-1",
    repo,
    issue,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: at(minutes),
  });
  const end = (
    repo: string,
    issue: number,
    minutes: number,
    to: string,
    reason: string,
    from = "IN PROGRESS",
  ): PanelLine => ({ runId: "run-panel-1", repo, issue, from, to, reason, time: at(minutes) });
  return [
    begin(APP, 21, 0),
    begin("scratch", 7, 5),
    begin(APP, 22, 10),
    begin(APP, 24, 20),
    end("scratch", 7, 30, "BLOCKED", "no token"),
    begin(APP, 25, 60),
    end(APP, 25, 90, "DONE", "merged #53", "IN REVIEW"),
    end(APP, 21, 120, "DONE", "merged #50", "IN REVIEW"),
    begin(APP, 23, 150),
    end(APP, 22, 180, "IN REVIEW", "merge-ready #51"),
    end(APP, 23, 240, "BLOCKED", "gate failed"),
  ];
}

/** The lines of a newer run `run-panel-2`: one build of `acme/app` #26, which merges. */
export function runTwoLines(now: Date): PanelLine[] {
  return [
    {
      runId: "run-panel-2",
      repo: APP,
      issue: 26,
      from: "READY",
      to: "IN PROGRESS",
      reason: "build started",
      time: new Date(now.getTime() - 5 * MINUTE_MS),
    },
    {
      runId: "run-panel-2",
      repo: APP,
      issue: 26,
      from: "IN PROGRESS",
      to: "DONE",
      reason: "merged #54",
      time: new Date(now.getTime() - 2 * MINUTE_MS),
    },
  ];
}

interface ControlEvent {
  kind: "gate" | "escalated" | "waiver_used";
  repo: string;
  pr: number;
  /** Minutes before the time of the test: a larger value is an older event. */
  ago: number;
  fields: Record<string, unknown>;
}

const gate = (
  repo: string,
  pr: number,
  round: number,
  decision: string,
  tier: string | null,
  ago: number,
): ControlEvent => ({
  kind: "gate",
  repo,
  pr,
  ago,
  fields: {
    issue: null,
    tier,
    round,
    decision,
    counts: {},
    categories: [],
    refs: [],
    waived: [],
  },
});

const escalated = (
  repo: string,
  pr: number,
  pathTier: string,
  tier: string,
  ago: number,
): ControlEvent => ({
  kind: "escalated",
  repo,
  pr,
  ago,
  fields: { issue: null, path_tier: pathTier, tier, paths: [], evidence: [] },
});

const waiver = (repo: string, pr: number, ago: number): ControlEvent => ({
  kind: "waiver_used",
  repo,
  pr,
  ago,
  fields: { waiver: "W-1", finding: "f" },
});

/**
 * The Control events of `acme/app` and `acme/site`:
 *
 * - First-round pass, tier `general`: PR 40 (round 1 fails), PR 41 and PR 12, which is not cached.
 *   Tier `sensitive`: PR 42, which reaches round 3.
 * - Highest rounds: PR 12 and PR 41 round 1, PR 40 round 2, PR 42 round 3.
 * - Escalations: 2 for PR 40 (`general` to `sensitive`, then `sensitive` to `authority`), 1 for PR 41.
 * - Waivers: `W-1` of `acme/app` on PR 4 and PR 5, and `W-1` of `acme/site` on PR 9.
 */
function controlEvents(): ControlEvent[] {
  return [
    gate(APP, 40, 1, "fail", "general", 50),
    gate(APP, 40, 2, "pass", "general", 40),
    gate(APP, 41, 1, "pass", "general", 50),
    gate(APP, 12, 1, "pass", "general", 50),
    gate(APP, 42, 1, "fail", "sensitive", 50),
    gate(APP, 42, 2, "fail", "sensitive", 40),
    gate(APP, 42, 3, "blocked", "sensitive", 30),
    escalated(APP, 40, "sensitive", "authority", 35),
    escalated(APP, 40, "general", "sensitive", 45),
    escalated(APP, 41, "general", "sensitive", 44),
    waiver(APP, 4, 20),
    waiver(APP, 5, 19),
    waiver(SITE, 9, 18),
  ];
}

/** The night log of `run-panel-1` and the Control events, as files of the Claude folder. */
export function listPanelFiles(now: Date): Record<string, string> {
  const files: Record<string, string> = nightLogFiles(runOneLines(now));
  for (const event of controlEvents()) {
    const time = new Date(now.getTime() - event.ago * MINUTE_MS);
    const file = dayFile("controls", time);
    const text = JSON.stringify({
      kind: event.kind,
      repo: event.repo,
      time: stamp(time),
      pr: event.pr,
      ...event.fields,
    });
    files[file] = `${files[file] ?? ""}${text}\n`;
  }
  return files;
}

/**
 * The Work cache of the List panel tests. `acme/app` has the issues of the builds (the title of #21
 * holds markup), issue 14 with a closed pull request 40 and an open pull request 44, a cached pull
 * request 41 with no issue, and 2 BLOCKED issues (#23 and #60). `bebopaloo/tools` has 1 BLOCKED issue.
 * The pull requests 12, 42, 4, 5 and 9 are not cached.
 */
export const LIST_PANEL_CACHE: WorkSeed = {
  repos: [
    { fullName: APP, client: "acme" },
    { fullName: SITE, client: "acme" },
    { fullName: TOOLS, client: "bebopaloo" },
    { fullName: "misc/notes", client: null },
  ],
  issues: [
    { repo: APP, number: 21, title: PANEL_HOSTILE_TITLE, issueState: "DONE", state: "closed" },
    { repo: APP, number: 22, title: "Sort the invoices", issueState: "IN REVIEW" },
    { repo: APP, number: 23, title: "Archive the invoices", issueState: "BLOCKED" },
    { repo: APP, number: 24, title: "Fix the footer", issueState: "IN PROGRESS" },
    { repo: APP, number: 25, title: "Reject a transfer", issueState: "DONE", state: "closed" },
    { repo: APP, number: 26, title: "Plan the search", issueState: "DONE", state: "closed" },
    { repo: APP, number: 14, title: "Add the export", issueState: "IN REVIEW" },
    { repo: APP, number: 60, title: "Match the payee", issueState: "BLOCKED" },
    { repo: TOOLS, number: 61, title: "Write the guide", issueState: "BLOCKED" },
  ],
  pullRequests: [
    { repo: APP, number: 40, title: "Add the export", state: "closed", linkedIssue: 14 },
    { repo: APP, number: 44, title: "Add the export again", state: "open", linkedIssue: 14 },
    { repo: APP, number: 41, title: "Change the sort order" },
  ],
};
