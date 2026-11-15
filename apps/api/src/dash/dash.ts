import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import type { DashResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { readRepoList, type RepoListResult } from "../work/repo-list.ts";
import { readControlEvents, type ControlEventsRead } from "./control-events.ts";
import type { SkippedFile } from "./jsonl-window.ts";
import { readNightLog, readRunLock, type NightLogRead, type RunLockRead } from "./night-log.ts";
import { folderLabel, runsInWindow, type Run, type RunRepo, type RunScope } from "./runs.ts";

export interface DashSources {
  nightLog: NightLogRead;
  lock: RunLockRead;
  controls: ControlEventsRead;
  repoList: RepoListResult;
  /** The issues that have children in the Work cache, as `<repo ID>#<number>`. */
  parents: Set<string>;
}

export interface DashRead {
  response: DashResponse;
  /** The files with skipped lines: the log shows the names and the counts, never a line. */
  reports: { folder: "runs" | "controls"; files: SkippedFile[] }[];
}

async function readParents(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ repoId: schema.workIssues.repoId, number: schema.workIssues.number })
    .from(schema.workIssues)
    .where(sql`cardinality(${schema.workIssues.children}) > 0`);
  return new Set(rows.map((row) => `${row.repoId}#${row.number.toString()}`));
}

export async function readDashSources(
  claudeDir: string,
  now: Date,
  db: Database,
): Promise<DashSources> {
  const [nightLog, lock, controls, repoList, parents] = await Promise.all([
    readNightLog(claudeDir, now),
    readRunLock(claudeDir, now),
    readControlEvents(claudeDir, now),
    readRepoList(claudeDir),
    readParents(db),
  ]);
  return { nightLog, lock, controls, repoList, parents };
}

/** The repo of a night log line: the repo list entry whose `path` is the line's `repo`. */
function repoResolver(repoList: RepoListResult): (folder: string) => RunRepo {
  const byPath = new Map<string, RunRepo>();
  if (repoList.status === "ok") {
    for (const entry of repoList.repos) {
      if (byPath.has(entry.path)) continue;
      byPath.set(entry.path, {
        key: entry.id,
        id: entry.id,
        label:
          entry.owner === null || entry.name === null
            ? folderLabel(entry.path)
            : `${entry.owner}/${entry.name}`,
        client: entry.client,
      });
    }
  }
  return (folder) =>
    byPath.get(folder) ?? { key: folder, id: null, label: folderLabel(folder), client: null };
}

function lastRunOf(
  { nightLog, lock, repoList, parents }: DashSources,
  scope: RunScope,
  now: Date,
): DashResponse["lastRun"] {
  const [run]: (Run | undefined)[] = runsInWindow({
    entries: nightLog.entries,
    repoOf: repoResolver(repoList),
    isParent: (repo, issue) => repo.id !== null && parents.has(`${repo.id}#${issue.toString()}`),
    scope,
    lockRunId: lock.state === "held" && !lock.stale ? lock.runId : null,
    now,
  });
  if (run === undefined) return null;
  return {
    runId: run.runId,
    start: run.start.toISOString(),
    end: run.end.toISOString(),
    running: run.running,
    lanes: run.lanes,
    skips: run.skips,
    blockedAtSelection: run.blockedAtSelection,
    builds: run.builds.map((build) => ({
      repoId: build.repo.id,
      repo: build.repo.label,
      issue: build.issue,
      start: build.start.toISOString(),
      end: build.end.toISOString(),
      result: build.result,
      lane: build.lane,
    })),
  };
}

function runOf(lock: RunLockRead): DashResponse["run"] {
  if (lock.state === "unreadable") {
    return { state: "unreadable", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null };
  }
  if (lock.state === "none") {
    return { state: "none", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null };
  }
  return {
    state: lock.stale ? "none" : "in_progress",
    stale: lock.stale,
    heartbeatAt: lock.heartbeatAt.toISOString(),
    heartbeatAgeSeconds: lock.ageSeconds,
  };
}

export function buildDash(
  sources: DashSources,
  scope: RunScope = { kind: "all" },
  now: Date = new Date(),
): DashRead {
  const { nightLog, lock, controls } = sources;
  return {
    response: {
      run: runOf(lock),
      lastRun: lastRunOf(sources, scope, now),
      sources: { runs: nightLog.folder, controls: controls.folder },
      skipped: {
        nightLogLines: nightLog.skippedLines,
        controlEvents: controls.skippedLines,
        files: nightLog.skippedFiles + controls.skippedFiles,
        lock: lock.state === "unreadable" ? 1 : 0,
      },
    },
    reports: [
      { folder: "runs", files: nightLog.reports },
      { folder: "controls", files: controls.reports },
    ],
  };
}
