import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import type { DashRepo, DashResponse } from "@foreman/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { readRepoList, type RepoListResult } from "../work/repo-list.ts";
import { readControlEvents, type ControlEventsRead } from "./control-events.ts";
import type { SkippedFile } from "./jsonl-window.ts";
import { readNightLog, readRunLock, type NightLogRead, type RunLockRead } from "./night-log.ts";
import {
  BUILD_SLOTS,
  CONNECTED_STATES,
  isConnectedState,
  pipelineCounts,
  runningBuilds,
  type CachedIssue,
  type CachedPullRequest,
} from "./pipeline.ts";
import { PARTIAL_STATE } from "../work/fetch-repo.ts";
import { waitsOf } from "./waits.ts";
import { reviewHealth, type ConnectedRepo } from "./review-health.ts";
import { folderLabel, runsInWindow, type Run, type RunRepo, type RunScope } from "./runs.ts";

export interface DashSources {
  nightLog: NightLogRead;
  lock: RunLockRead;
  controls: ControlEventsRead;
  repoList: RepoListResult;
  /** The issues that have children in the Work cache, as `<repo ID>#<number>`. */
  parents: Set<string>;
  /** The Factory identity logins, lower case. Empty with no setting. */
  factoryLogins: ReadonlySet<string>;
  /** The repos with a connected forge in the Work cache, by repo ID: the counts of factory pull requests, or null. */
  connected: Map<string, { reviewed: number; unreviewed: number } | null>;
  work: WorkCache;
}

/** The Work cache rows that the pipeline strip, the running builds and the Waits total use. */
export interface WorkCache {
  /** The fetch state of the tracker role of each cached repo, by repo ID. */
  trackerStates: Map<string, string | null>;
  /** The forge state, the tracker state and the last good fetch of each cached repo, by repo ID. */
  repoRows: Map<
    string,
    { forgeState: string | null; trackerState: string | null; lastGoodFetchAt: Date | null }
  >;
  issues: CachedIssue[];
  pullRequests: CachedPullRequest[];
}

export interface DashRead {
  response: DashResponse;
  /** The files with skipped lines: the log shows the names and the counts, never a line. */
  reports: { folder: "runs" | "controls"; files: SkippedFile[] }[];
}

async function readWorkCache(db: Database): Promise<WorkCache> {
  const [repos, issues, pulls] = await Promise.all([
    db
      .select({
        id: schema.workRepos.id,
        forgeState: schema.workRepos.forgeState,
        trackerState: schema.workRepos.trackerState,
        lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
      })
      .from(schema.workRepos),
    db
      .select({
        repoId: schema.workIssues.repoId,
        number: schema.workIssues.number,
        title: schema.workIssues.title,
        priority: schema.workIssues.priority,
        link: schema.workIssues.link,
        state: schema.workIssues.state,
        issueState: schema.workIssues.issueState,
        labels: schema.workIssues.labels,
        hasChildren: sql<boolean>`cardinality(${schema.workIssues.children}) > 0`,
      })
      .from(schema.workIssues),
    db
      .select({
        repoId: schema.workPullRequests.repoId,
        number: schema.workPullRequests.number,
        title: schema.workPullRequests.title,
        link: schema.workPullRequests.link,
        state: schema.workPullRequests.state,
        baseBranch: schema.workPullRequests.baseBranch,
      })
      .from(schema.workPullRequests)
      .where(eq(schema.workPullRequests.state, "open")),
  ]);
  return {
    trackerStates: new Map(repos.map((repo) => [repo.id, repo.trackerState])),
    repoRows: new Map(repos.map((repo) => [repo.id, repo])),
    issues,
    pullRequests: pulls,
  };
}

export async function readParents(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ repoId: schema.workIssues.repoId, number: schema.workIssues.number })
    .from(schema.workIssues)
    .where(sql`cardinality(${schema.workIssues.children}) > 0`);
  return new Set(rows.map((row) => `${row.repoId}#${row.number.toString()}`));
}

/**
 * For each connected repo: its cached pull requests whose author is a Factory identity login, and
 * how many of them have a review by such a login. A pull request of any other author is in neither count.
 */
async function readConnected(
  db: Database,
  logins: ReadonlySet<string>,
): Promise<DashSources["connected"]> {
  const rows = await db
    .select({ id: schema.workRepos.id })
    .from(schema.workRepos)
    .where(inArray(schema.workRepos.forgeState, [...CONNECTED_STATES]));
  const connected: DashSources["connected"] = new Map(rows.map((row) => [row.id, null]));
  if (logins.size === 0 || rows.length === 0) return connected;
  const ids = rows.map((row) => row.id);
  const [pulls, reviews] = await Promise.all([
    db
      .select({
        repoId: schema.workPullRequests.repoId,
        number: schema.workPullRequests.number,
        author: schema.workPullRequests.author,
      })
      .from(schema.workPullRequests)
      .where(inArray(schema.workPullRequests.repoId, ids)),
    db
      .select({
        repoId: schema.workReviews.repoId,
        number: schema.workReviews.pullRequestNumber,
        author: schema.workReviews.author,
      })
      .from(schema.workReviews)
      .where(inArray(schema.workReviews.repoId, ids)),
  ]);
  const key = (repoId: string, number: number): string => `${repoId}#${number.toString()}`;
  const reviewed = new Set(
    reviews
      .filter((review) => logins.has(review.author.toLowerCase()))
      .map((review) => key(review.repoId, review.number)),
  );
  for (const id of ids) connected.set(id, { reviewed: 0, unreviewed: 0 });
  for (const pull of pulls) {
    const counts = connected.get(pull.repoId);
    if (counts == null || !logins.has(pull.author.toLowerCase())) continue;
    if (reviewed.has(key(pull.repoId, pull.number))) counts.reviewed += 1;
    else counts.unreviewed += 1;
  }
  return connected;
}

export async function readDashSources(
  claudeDir: string,
  now: Date,
  db: Database,
  factoryLogins: readonly string[] = [],
): Promise<DashSources> {
  const logins = new Set(factoryLogins.map((login) => login.toLowerCase()));
  const [nightLog, lock, controls, repoList, parents, connected, work] = await Promise.all([
    readNightLog(claudeDir, now),
    readRunLock(claudeDir, now),
    readControlEvents(claudeDir, now),
    readRepoList(claudeDir),
    readParents(db),
    readConnected(db, logins),
    readWorkCache(db),
  ]);
  return { nightLog, lock, controls, repoList, parents, factoryLogins: logins, connected, work };
}

/** The repo of a night log line: the repo list entry whose `path` is the line's `repo`. */
export function repoResolver(repoList: RepoListResult): (folder: string) => RunRepo {
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

function cachedIssue(
  cached: ReadonlyMap<string, CachedIssue>,
  build: { repo: RunRepo; issue: number },
): CachedIssue | undefined {
  return build.repo.id === null
    ? undefined
    : cached.get(`${build.repo.id}#${build.issue.toString()}`);
}

function lastRunOf(
  { nightLog, lock, repoList, parents, work }: DashSources,
  scope: RunScope,
  now: Date,
): { lastRun: DashResponse["lastRun"]; peak: number } {
  const [run]: (Run | undefined)[] = runsInWindow({
    entries: nightLog.entries,
    repoOf: repoResolver(repoList),
    isParent: (repo, issue) => repo.id !== null && parents.has(`${repo.id}#${issue.toString()}`),
    scope,
    lockRunId: lock.state === "held" && !lock.stale ? lock.runId : null,
    now,
  });
  if (run === undefined) return { lastRun: null, peak: 0 };
  const cached = new Map(
    work.issues.map((issue) => [`${issue.repoId}#${issue.number.toString()}`, issue]),
  );
  const lastRun = {
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
      title: cachedIssue(cached, build)?.title ?? null,
      link: cachedIssue(cached, build)?.link ?? null,
      start: build.start.toISOString(),
      end: build.end.toISOString(),
      result: build.result,
      lane: build.lane,
    })),
  };
  return { lastRun, peak: run.peak };
}

/** The distinct repo list entries in scope, with or without a forge name. */
function entriesInScope(repoList: RepoListResult, scope: RunScope) {
  if (repoList.status !== "ok") return [];
  const seen = new Set<string>();
  return repoList.repos.filter((entry) => {
    if (seen.has(entry.id)) return false;
    if (scope.kind === "client" && entry.client !== scope.client) return false;
    seen.add(entry.id);
    return true;
  });
}

/** The repos of the repo list in scope that have a forge name. */
function reposInScope(repoList: RepoListResult, scope: RunScope) {
  return entriesInScope(repoList, scope).filter(
    (entry) => entry.owner !== null && entry.name !== null,
  );
}

function reviewHealthOf(
  { controls, repoList, connected, factoryLogins }: DashSources,
  scope: RunScope,
): DashResponse["reviewHealth"] {
  const entries = reposInScope(repoList, scope);
  const connectedRepos: ConnectedRepo[] = entries.flatMap((entry) =>
    connected.has(entry.id)
      ? [
          {
            id: entry.id,
            label: `${entry.owner ?? ""}/${entry.name ?? ""}`,
            factory: connected.get(entry.id) ?? null,
          },
        ]
      : [],
  );
  return reviewHealth({
    events: controls.events,
    // A Client scope uses the events of the repos of that client only.
    scopeRepos:
      scope.kind === "all"
        ? null
        : new Set(entries.map((entry) => `${entry.owner ?? ""}/${entry.name ?? ""}`.toLowerCase())),
    connected: connectedRepos,
    factoryLoginSet: factoryLogins.size > 0,
  });
}

/** The reason of the newest night log line with `to` BLOCKED of each issue, by `<repo ID>#<issue>`. */
export function blockedReasonsOf({ nightLog, repoList }: DashSources): Map<string, string> {
  const repoOf = repoResolver(repoList);
  const newest = new Map<string, { time: number; reason: string }>();
  for (const entry of nightLog.entries) {
    const { id } = repoOf(entry.repo);
    if (entry.to !== "BLOCKED" || id === null) continue;
    const key = `${id}#${entry.issue.toString()}`;
    const time = entry.time.getTime();
    if (time >= (newest.get(key)?.time ?? -Infinity))
      newest.set(key, { time, reason: entry.reason });
  }
  return new Map([...newest].map(([key, { reason }]) => [key, reason]));
}

/** The connected repos in scope, and the Work cache rows of those repos. The dash and the set rows both use it. */
export function connectedWork(sources: DashSources, scope: RunScope) {
  const entries = reposInScope(sources.repoList, scope);
  const connected = entries.filter((entry) =>
    isConnectedState(sources.work.trackerStates.get(entry.id)),
  );
  const ids = new Set(connected.map((entry) => entry.id));
  return {
    entries,
    connected,
    issues: sources.work.issues.filter((issue) => ids.has(issue.repoId)),
    pulls: sources.work.pullRequests.filter((pull) => ids.has(pull.repoId)),
    repoLabels: new Map(
      connected.map((entry) => [entry.id, `${entry.owner ?? ""}/${entry.name ?? ""}`]),
    ),
  };
}

/** The data of the forge sections, from the Work cache rows of the connected repos in scope. */
function workOf(
  sources: DashSources,
  scope: RunScope,
  runState: DashResponse["run"]["state"],
): Pick<DashResponse, "tiles" | "running" | "pipeline" | "waits" | "complete"> {
  const { entries, connected, issues, pulls, repoLabels } = connectedWork(sources, scope);
  const complete = {
    connectedRepos: connected.length,
    missingRepos: entries.length - connected.length,
  };
  if (connected.length === 0) {
    return { tiles: noTiles, running: null, pipeline: null, waits: null, complete };
  }
  const waits = waitsOf({
    issues,
    pulls,
    repoLabels,
    blockedReasons: blockedReasonsOf(sources),
  });
  const enabled = new Set(connected.filter((entry) => entry.enabled).map((entry) => entry.id));
  return {
    tiles: { ...noTiles, waits: waits.total },
    running: {
      count: runningBuilds(issues, enabled),
      // A client scope shows no slot count, so that the load of other clients does not show.
      slotLimit: scope.kind === "all" && runState === "in_progress" ? BUILD_SLOTS : null,
    },
    pipeline: pipelineCounts(issues, pulls),
    waits,
    complete,
  };
}

const NOT_CONFIGURED = "not configured";

/** The first role state that is not connected, else `partial`, else `connected`. No role state is `not fetched`. */
export function connectionState(
  row: { forgeState: string | null; trackerState: string | null } | undefined,
): string {
  const states = [row?.forgeState, row?.trackerState].flatMap((state) =>
    state == null || state === NOT_CONFIGURED ? [] : [state],
  );
  if (states.length === 0) return "not fetched";
  const problem = states.find((state) => !isConnectedState(state));
  if (problem !== undefined) return problem;
  return states.includes(PARTIAL_STATE) ? PARTIAL_STATE : "connected";
}

/** The repos in scope, named or not, each with its connection state and the times of its newest log line and Control event. */
function reposOf({ repoList, work, nightLog, controls }: DashSources, scope: RunScope): DashRepo[] {
  const repoOf = repoResolver(repoList);
  const logTimes = new Map<string, number>();
  for (const line of nightLog.entries) {
    const { id } = repoOf(line.repo);
    if (id !== null) logTimes.set(id, Math.max(logTimes.get(id) ?? -Infinity, line.time.getTime()));
  }
  const controlTimes = new Map<string, number>();
  for (const event of controls.events) {
    const key = event.repo.toLowerCase();
    controlTimes.set(key, Math.max(controlTimes.get(key) ?? -Infinity, event.at.getTime()));
  }
  const iso = (time: number | undefined): string | null =>
    time === undefined ? null : new Date(time).toISOString();
  return entriesInScope(repoList, scope).map((entry) => {
    const named = entry.owner !== null && entry.name !== null;
    const label =
      entry.owner !== null && entry.name !== null
        ? `${entry.owner}/${entry.name}`
        : folderLabel(entry.path);
    const row = work.repoRows.get(entry.id);
    return {
      repoId: entry.id,
      repo: label,
      client: entry.client,
      state: named ? connectionState(row) : "not connected: no forge name",
      dataAsOf: row?.lastGoodFetchAt?.toISOString() ?? null,
      lastLogAt: iso(logTimes.get(entry.id)),
      lastControlAt: named ? iso(controlTimes.get(label.toLowerCase())) : null,
    };
  });
}

const noTiles = { builds: null, peak: null, merged: null, waits: null };

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
  const run = runOf(lock);
  const { lastRun, peak } = lastRunOf(sources, scope, now);
  const forge = workOf(sources, scope, run.state);
  return {
    response: {
      run,
      lastRun,
      reviewHealth: reviewHealthOf(sources, scope),
      tiles: {
        ...forge.tiles,
        builds: lastRun?.builds.length ?? null,
        peak: lastRun === null ? null : peak,
        merged: lastRun?.builds.filter((build) => build.result === "merged").length ?? null,
      },
      running: forge.running,
      pipeline: forge.pipeline,
      waits: forge.waits,
      complete: forge.complete,
      repos: reposOf(sources, scope),
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
