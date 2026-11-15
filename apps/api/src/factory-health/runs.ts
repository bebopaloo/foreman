import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import {
  BUILD_RESULTS,
  type BuildResult,
  type FactoryRunRow,
  type FactoryRunsResponse,
  type StoppedItem,
} from "@foreman/shared";
import { and, inArray } from "drizzle-orm";
import { readParents, repoResolver } from "../dash/dash.ts";
import { readNightLog, readRunLock, type NightLogEntry } from "../dash/night-log.ts";
import { BUILD_SLOTS } from "../dash/pipeline.ts";
import { runsInWindow, type Run, type RunScope } from "../dash/runs.ts";
import { readRepoList } from "../work/repo-list.ts";

export interface FactoryRunsRead {
  /** Every run of the window in scope, newest first. */
  rows: FactoryRunRow[];
  sources: FactoryRunsResponse["sources"];
  skipped: FactoryRunsResponse["skipped"];
  /** The files with skipped lines, for the log. */
  reports: { file: string; lines: number }[];
}

const STOPPED: ReadonlySet<BuildResult> = new Set(["in review", "stopped at run end"]);

function countResults(run: Run): Record<BuildResult, number> {
  const counts = Object.fromEntries(BUILD_RESULTS.map((result) => [result, 0])) as Record<
    BuildResult,
    number
  >;
  for (const build of run.builds) counts[build.result] += 1;
  return counts;
}

/** A link is shown only when it is an http or https URL. */
function safeLink(link: string | null): string | null {
  return link !== null && /^https?:\/\//i.test(link) ? link : null;
}

/** The window start of the first later run with a line for the issue, or null. */
function resumedBy(
  run: Run,
  later: readonly Run[],
  linesOf: ReadonlyMap<string, readonly NightLogEntry[]>,
  isRepo: (line: NightLogEntry) => boolean,
  issue: number,
): string | null {
  const after = later
    .filter((other) => other.start.getTime() > run.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const other of after) {
    const lines = linesOf.get(other.runId) ?? [];
    if (lines.some((line) => line.issue === issue && isRepo(line))) {
      return other.start.toISOString();
    }
  }
  return null;
}

/** Orders runs newest first by their end, then by run ID, so a cursor key is unique. */
export function compareRunRows(
  a: Pick<FactoryRunRow, "end" | "runId">,
  b: Pick<FactoryRunRow, "end" | "runId">,
): number {
  if (a.end !== b.end) return a.end < b.end ? 1 : -1;
  return a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0;
}

export async function readFactoryRuns(options: {
  claudeDir: string;
  db: Database;
  scope: RunScope;
  now: Date;
}): Promise<FactoryRunsRead> {
  const { claudeDir, db, scope, now } = options;
  const [nightLog, lock, repoList, parents] = await Promise.all([
    readNightLog(claudeDir, now),
    readRunLock(claudeDir, now),
    readRepoList(claudeDir),
    readParents(db),
  ]);
  const repoOf = repoResolver(repoList);
  const runs = runsInWindow({
    entries: nightLog.entries,
    repoOf,
    isParent: (repo, issue) => repo.id !== null && parents.has(`${repo.id}#${issue.toString()}`),
    scope,
    lockRunId: lock.state === "held" && !lock.stale ? lock.runId : null,
    now,
  });

  // The lines of each run in scope, to find the lines of a stopped item in a later run.
  const linesOf = new Map<string, NightLogEntry[]>();
  for (const entry of nightLog.entries) {
    const repo = repoOf(entry.repo);
    if (scope.kind === "client" && repo.client !== scope.client) continue;
    linesOf.set(entry.runId, [...(linesOf.get(entry.runId) ?? []), entry]);
  }

  const stoppedByRun = runs.map((run) =>
    run.running ? [] : run.builds.filter((build) => STOPPED.has(build.result)),
  );
  const repoIds = [
    ...new Set(
      stoppedByRun.flatMap((builds) =>
        builds.flatMap((build) => (build.repo.id === null ? [] : [build.repo.id])),
      ),
    ),
  ];
  const issues =
    repoIds.length === 0
      ? []
      : await db
          .select({
            repoId: schema.workIssues.repoId,
            number: schema.workIssues.number,
            title: schema.workIssues.title,
            link: schema.workIssues.link,
          })
          .from(schema.workIssues)
          .where(
            and(
              inArray(schema.workIssues.repoId, repoIds),
              inArray(schema.workIssues.number, [
                ...new Set(stoppedByRun.flatMap((builds) => builds.map((build) => build.issue))),
              ]),
            ),
          );
  const cached = new Map(
    issues.map((issue) => [`${issue.repoId}#${issue.number.toString()}`, issue]),
  );

  const rows = runs.map((run, index): FactoryRunRow => {
    const stopped = (stoppedByRun[index] ?? []).map((build): StoppedItem => {
      const row =
        build.repo.id === null
          ? undefined
          : cached.get(`${build.repo.id}#${build.issue.toString()}`);
      return {
        repoId: build.repo.id,
        repo: build.repo.label,
        issue: build.issue,
        result: build.result === "in review" ? "in review" : "stopped at run end",
        title: row?.title ?? null,
        link: safeLink(row?.link ?? null),
        resumedBy: resumedBy(
          run,
          runs,
          linesOf,
          (line) => repoOf(line.repo).key === build.repo.key,
          build.issue,
        ),
      };
    });
    return {
      runId: run.runId,
      start: run.start.toISOString(),
      end: run.end.toISOString(),
      running: run.running,
      builds: run.builds.length,
      results: countResults(run),
      peak: run.peak,
      slotLimit: scope.kind === "all" ? BUILD_SLOTS : null,
      skips: run.skips,
      blockedAtSelection: run.blockedAtSelection,
      stoppedItems: stopped,
    };
  });
  rows.sort(compareRunRows);
  return {
    rows,
    sources: { runs: nightLog.folder },
    skipped: { nightLogLines: nightLog.skippedLines, files: nightLog.skippedFiles },
    reports: nightLog.reports,
  };
}
