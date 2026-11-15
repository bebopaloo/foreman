import type { BuildResult } from "@foreman/shared";
import type { NightLogEntry } from "./night-log.ts";

/** Where a night log line belongs: the repo list entry whose `path` is the line's `repo`. */
export interface RunRepo {
  /** Identifies the repo inside a run. The repo ID, or the folder of a repo that is not in the list. */
  key: string;
  /** The repo ID, or null for a folder that is not in the repo list. */
  id: string | null;
  /** `owner/name`, or the last part of the folder. */
  label: string;
  client: string | null;
}

export type RunScope = { kind: "all" } | { kind: "client"; client: string };

export interface RunsInput {
  /** The night log lines of the window, oldest first. */
  entries: readonly NightLogEntry[];
  repoOf: (folder: string) => RunRepo;
  /** True for an issue that has children in the Work cache. */
  isParent: (repo: RunRepo, issue: number) => boolean;
  scope: RunScope;
  /** The run ID that the run lock holds while the lock is not stale. */
  lockRunId: string | null;
  now: Date;
}

export interface RunBuild {
  repo: RunRepo;
  issue: number;
  start: Date;
  end: Date;
  result: BuildResult;
  /** The build has a line with `to` IN PROGRESS in its run. Otherwise `start` is the start of the run. */
  started: boolean;
  /** The reasons of the lines of the build, oldest first. */
  reasons: string[];
  lane: number;
}

export interface Run {
  runId: string;
  start: Date;
  end: Date;
  running: boolean;
  builds: RunBuild[];
  lanes: number;
  skips: number;
  blockedAtSelection: number;
  /** The highest count of builds at one time in the run. A build that starts when another ends does not overlap it. */
  peak: number;
}

interface ScopedLine {
  entry: NightLogEntry;
  repo: RunRepo;
  /** The position in the input, to order lines with the same time. */
  index: number;
}

/** The last part of a repo folder, as the label of a repo that is not in the repo list. */
export function folderLabel(folder: string): string {
  const parts = folder.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? folder;
}

function endResult(entry: NightLogEntry): BuildResult | null {
  if (entry.to === "DONE" && entry.reason.startsWith("merged")) return "merged";
  if (entry.to === "IN REVIEW" && entry.reason.startsWith("merge-ready")) return "merge-ready";
  if (entry.to === "BLOCKED") return "blocked";
  if (entry.to === "CANCELLED") return "cancelled";
  return null;
}

const isSkip = (entry: NightLogEntry): boolean => entry.from === "READY" && entry.to === "READY";

function assignLanes(builds: Omit<RunBuild, "lane">[]): RunBuild[] {
  const ordered = [...builds].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.repo.label.localeCompare(b.repo.label) ||
      a.issue - b.issue,
  );
  const laneEnds: number[] = [];
  return ordered.map((build) => {
    let index = laneEnds.findIndex((end) => end <= build.start.getTime());
    if (index === -1) index = laneEnds.length;
    laneEnds[index] = build.end.getTime();
    return { ...build, lane: index + 1 };
  });
}

function peakOf(builds: readonly RunBuild[]): number {
  const edges = builds.flatMap((build) => [
    { time: build.start.getTime(), change: 1 },
    { time: build.end.getTime(), change: -1 },
  ]);
  // At one time, the ends come before the starts.
  edges.sort((a, b) => a.time - b.time || a.change - b.change);
  let open = 0;
  let peak = 0;
  for (const edge of edges) {
    open += edge.change;
    peak = Math.max(peak, open);
  }
  return peak;
}

function buildRun(runId: string, lines: ScopedLine[], input: RunsInput): Run {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) throw new Error("A run has at least one line.");
  const running = input.lockRunId === runId;
  const start = first.entry.time;
  const end = running ? input.now : last.entry.time;

  const byIssue = new Map<string, ScopedLine[]>();
  let skips = 0;
  for (const line of lines) {
    if (isSkip(line.entry)) {
      skips += 1;
    } else if (!input.isParent(line.repo, line.entry.issue)) {
      const key = `${line.repo.key}#${line.entry.issue.toString()}`;
      byIssue.set(key, [...(byIssue.get(key) ?? []), line]);
    }
  }

  // The first line of an issue in the run, skips included, decides if it was blocked at selection.
  const firstSeen = new Set<string>();
  let blockedAtSelection = 0;
  const builds: Omit<RunBuild, "lane">[] = [];
  for (const line of lines) {
    const key = `${line.repo.key}#${line.entry.issue.toString()}`;
    if (!firstSeen.has(key)) {
      firstSeen.add(key);
      if (
        line.entry.from === "READY" &&
        line.entry.to === "BLOCKED" &&
        !input.isParent(line.repo, line.entry.issue)
      ) {
        blockedAtSelection += 1;
        byIssue.set(
          key,
          (byIssue.get(key) ?? []).filter((other) => other !== line),
        );
      }
    }
  }

  for (const issueLines of byIssue.values()) {
    const [head] = issueLines;
    if (head === undefined) continue;
    const started = issueLines.find((line) => line.entry.to === "IN PROGRESS");
    const buildStart = started?.entry.time ?? start;
    const fromStart =
      started === undefined ? issueLines : issueLines.slice(issueLines.indexOf(started));
    const ending = fromStart.find((line) => endResult(line.entry) !== null);
    if (ending !== undefined) {
      builds.push({
        repo: head.repo,
        issue: head.entry.issue,
        start: buildStart,
        end: ending.entry.time,
        result: endResult(ending.entry) ?? "stopped at run end",
        started: started !== undefined,
        reasons: issueLines.map((line) => line.entry.reason),
      });
      continue;
    }
    const lastLine = issueLines[issueLines.length - 1];
    builds.push({
      repo: head.repo,
      issue: head.entry.issue,
      start: buildStart,
      end,
      started: started !== undefined,
      reasons: issueLines.map((line) => line.entry.reason),
      result: running
        ? "running"
        : lastLine?.entry.to === "IN REVIEW"
          ? "in review"
          : "stopped at run end",
    });
  }

  const laned = assignLanes(builds);
  return {
    runId,
    start,
    end,
    running,
    builds: laned,
    lanes: laned.reduce((most, build) => Math.max(most, build.lane), 0),
    skips,
    blockedAtSelection,
    peak: peakOf(laned),
  };
}

/**
 * Every run of the window in one scope, newest first. A run is the lines of one `run_id`, with its
 * builds (start, end, result and lane), its skips, its count blocked at selection and its peak. In a
 * client scope, a run uses only the lines of that client's repos, and a run with no such line is not
 * a run of the scope. The dash takes the first run. The Reviews view and the Factory health view
 * take every run.
 */
export function runsInWindow(input: RunsInput): Run[] {
  const groups = new Map<string, ScopedLine[]>();
  input.entries.forEach((entry, index) => {
    const repo = input.repoOf(entry.repo);
    if (input.scope.kind === "client" && repo.client !== input.scope.client) return;
    groups.set(entry.runId, [...(groups.get(entry.runId) ?? []), { entry, repo, index }]);
  });
  return [...groups.entries()]
    .map(([runId, lines]) => {
      const last = lines[lines.length - 1];
      return { runId, lines, time: last?.entry.time.getTime() ?? 0, index: last?.index ?? 0 };
    })
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .map(({ runId, lines }) => buildRun(runId, lines, input));
}
