import { schema, type Database } from "@foreman/db";
import type { ReviewsMode, ReviewsPullRequest, ReviewsResponse } from "@foreman/shared";
import { inArray } from "drizzle-orm";
import { readControlModules, type ControlModulesRow } from "../controls/modules.ts";
import type { ControlEvent } from "../dash/control-events.ts";
import { readDashSources, repoResolver, type DashSources } from "../dash/dash.ts";
import { reviewHealth } from "../dash/review-health.ts";
import { runsInWindow, type RunScope } from "../dash/runs.ts";
import type { CursorKey } from "../paging.ts";
import { linkFor } from "../work/lists.ts";
import type { RepoEntry } from "../work/repo-list.ts";
import {
  findingsByCategoryAndSeverity,
  mostFrequentRefs,
  securityFindings,
  securitySignals,
} from "./findings.ts";
import { pullRequestRecords, type PullRequestRecord, type Tier } from "./pr-records.ts";
import { roundsToSettle } from "./rounds.ts";
import {
  mergesByBaseAndTier,
  pathAgainstFinalTier,
  pullRequestsByFinalTier,
} from "./tier-results.ts";
import { buildTimes, timesByTier, type BuildTimeRow } from "./times.ts";

export interface ReviewsData {
  dash: DashSources;
  /** The repo list entries of the Client scope, and of the repo filter when there is one. */
  inScope: readonly RepoEntry[];
  /** The Client scope. With no client and no repo filter, the scope is all events. */
  client: string | undefined;
  narrowed: boolean;
  /** The repos in scope whose host the Work cache may be read for, by repo ID. */
  hosts: ReadonlyMap<string, string>;
  /** The repos in scope with cache rows. */
  cached: ReadonlySet<string>;
  /** The repos in scope whose last fetch had an error. */
  errored: ReadonlySet<string>;
  modules: ReadonlyMap<string, ControlModulesRow>;
  /** The link of each cached pull request, as `<repo ID>#<number>`. */
  links: ReadonlyMap<string, string | null>;
}

export interface ReviewsScope {
  inScope: readonly RepoEntry[];
  /** The repo IDs that the Work cache may be read for. */
  repoIds: readonly string[];
  client: string | undefined;
  narrowed: boolean;
}

const pullKey = (repoId: string, number: number): string => `${repoId}#${number.toString()}`;

export async function readReviewsData(
  claudeDir: string,
  now: Date,
  db: Database,
  factoryLogins: readonly string[],
  scope: ReviewsScope,
): Promise<ReviewsData> {
  const ids = [...scope.repoIds];
  const [dash, modules, repoRows, pullRows, issueRows] = await Promise.all([
    readDashSources(claudeDir, now, db, factoryLogins),
    readControlModules(db),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.workRepos.id,
            lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
            forgeErrorClass: schema.workRepos.forgeErrorClass,
            trackerErrorClass: schema.workRepos.trackerErrorClass,
          })
          .from(schema.workRepos)
          .where(inArray(schema.workRepos.id, ids)),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            repoId: schema.workPullRequests.repoId,
            number: schema.workPullRequests.number,
            link: schema.workPullRequests.link,
          })
          .from(schema.workPullRequests)
          .where(inArray(schema.workPullRequests.repoId, ids)),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinct({ repoId: schema.workIssues.repoId })
          .from(schema.workIssues)
          .where(inArray(schema.workIssues.repoId, ids)),
  ]);
  const cached = new Set<string>([
    ...pullRows.map((row) => row.repoId),
    ...issueRows.map((row) => row.repoId),
    ...repoRows.filter((row) => row.lastGoodFetchAt !== null).map((row) => row.id),
  ]);
  const errored = new Set(
    repoRows
      .filter((row) => row.forgeErrorClass !== null || row.trackerErrorClass !== null)
      .map((row) => row.id),
  );
  const hosts = new Map(scope.inScope.map((entry) => [entry.id, entry.host]));
  return {
    dash,
    inScope: scope.inScope,
    client: scope.client,
    narrowed: scope.narrowed,
    hosts,
    cached,
    errored,
    modules: new Map(modules.map((row) => [row.repoId, row])),
    links: new Map(pullRows.map((row) => [pullKey(row.repoId, row.number), row.link])),
  };
}

const fullName = (entry: RepoEntry): string | null =>
  entry.owner === null || entry.name === null ? null : `${entry.owner}/${entry.name}`;

interface Analysis {
  events: ControlEvent[];
  records: PullRequestRecord[];
  /** The records by repo ID (or by the event's repo name when the repo has no ID) and number. */
  recordByPull: Map<string, PullRequestRecord>;
  idOf: ReadonlyMap<string, string>;
  times: ReturnType<typeof buildTimes>;
}

function analyse(data: ReviewsData, now: Date): Analysis {
  const { dash, inScope, client, narrowed } = data;
  const names = new Set(
    inScope.flatMap((entry) => {
      const name = fullName(entry);
      return name === null ? [] : [name.toLowerCase()];
    }),
  );
  const events = narrowed
    ? dash.controls.events.filter((event) => names.has(event.repo.toLowerCase()))
    : dash.controls.events;
  const records = pullRequestRecords(events);

  const idOf = new Map<string, string>();
  if (dash.repoList.status === "ok") {
    for (const entry of dash.repoList.repos) {
      const name = fullName(entry);
      if (name !== null && !idOf.has(name.toLowerCase())) idOf.set(name.toLowerCase(), entry.id);
    }
  }
  // The builds know their repo by its ID, so the build times read events and records by repo ID.
  const idEvents = events.map((event) => {
    const id = idOf.get(event.repo.toLowerCase());
    return id === undefined ? event : { ...event, repo: id };
  });
  const idRecords = pullRequestRecords(idEvents);
  const scope: RunScope = client === undefined ? { kind: "all" } : { kind: "client", client };
  const runs = runsInWindow({
    entries: dash.nightLog.entries,
    repoOf: repoResolver(dash.repoList),
    isParent: (repo, issue) => repo.id !== null && dash.parents.has(pullKey(repo.id, issue)),
    scope,
    lockRunId: dash.lock.state === "held" && !dash.lock.stale ? dash.lock.runId : null,
    now,
  });
  return {
    events,
    records,
    recordByPull: new Map(idRecords.map((record) => [pullKey(record.repo, record.pr), record])),
    idOf,
    times: buildTimes({ runs, events: idEvents, records: idRecords }),
  };
}

const percentOf = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 100);

/**
 * The Agent span link and the split of a Review cycle go here: a row with the build end source
 * "agent span" counts in the aggregates. No Agent span is read yet, so every row has the build end
 * from the first gate event, or none, and no split.
 */
function agentSpanRows(rows: readonly BuildTimeRow[]): BuildTimeRow[] {
  return rows.filter((row) => row.buildEnd?.source === "agent span");
}

function reviewShare(rows: readonly BuildTimeRow[]): { percent: number | null; builds: number } {
  const timed = agentSpanRows(rows);
  const cycles = timed.reduce((sum, row) => sum + (row.reviewCycleSeconds ?? 0), 0);
  const builds = timed.reduce((sum, row) => sum + (row.buildSeconds ?? 0), 0);
  return { percent: percentOf(cycles, cycles + builds), builds: timed.length };
}

function eventsOffOf(data: ReviewsData) {
  const { dash, inScope, modules } = data;
  const withEvents = new Set(dash.controls.events.map((event) => event.repo.toLowerCase()));
  const seen = new Set<string>();
  const rows: ReviewsResponse["eventsOff"] = [];
  for (const entry of inScope) {
    const name = fullName(entry);
    if (name === null || seen.has(entry.id) || !dash.connected.has(entry.id)) continue;
    seen.add(entry.id);
    const config = modules.get(entry.id);
    const off = config?.config != null && !config.controlEvents;
    if (!off && withEvents.has(name.toLowerCase())) continue;
    const counts = dash.connected.get(entry.id) ?? null;
    const known = dash.factoryLogins.size > 0;
    rows.push({
      repoId: entry.id,
      repo: name,
      reason: off ? "module_off" : "no_events",
      reviewed: known ? (counts?.reviewed ?? null) : null,
      unreviewed: known ? (counts?.unreviewed ?? null) : null,
    });
  }

  return rows.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

export function buildReviews(data: ReviewsData, mode: ReviewsMode, now: Date): ReviewsResponse {
  const { dash, inScope, hosts, cached, errored, links } = data;
  const { events, records, idOf, times } = analyse(data, now);

  const firstRound = reviewHealth({
    events,
    scopeRepos: null,
    connected: [],
    factoryLoginSet: dash.factoryLogins.size > 0,
  }).firstRound;
  const withTier = records.filter((record) => record.finalTier !== null);
  const escalated = withTier.filter((record) => record.escalated).length;

  const finalTiers = pullRequestsByFinalTier(records);
  const merges = mergesByBaseAndTier(events).map(({ base, byTier, none }) => ({
    base,
    ...byTier,
    none,
  }));
  const { signals, more: signalsMore } = securitySignals(events, records);
  const refs = mostFrequentRefs(events);
  const categories = findingsByCategoryAndSeverity(records, mode);
  const security = securityFindings(records, mode);

  const cachedInScope = inScope.filter((entry) => cached.has(entry.id));
  const incomplete = inScope.filter((entry) => !cached.has(entry.id) || errored.has(entry.id));
  const rows = times.rows;

  return {
    tiles: {
      pullRequestsReviewed: { count: records.length },
      firstRoundPass: {
        percent: firstRound.rate,
        passed: firstRound.passed,
        total: firstRound.total,
      },
      escalationRate: {
        percent: percentOf(escalated, withTier.length),
        escalated,
        withTier: withTier.length,
      },
      reviewShare: reviewShare(rows),
    },
    tierResults: {
      byFinalTier: finalTiers,
      pathAgainstFinal: pathAgainstFinalTier(records),
      merges,
    },
    rounds: roundsToSettle(records),
    findings: {
      mode,
      security,
      byCategory: categories.byCategory,
      bySeverity: categories.bySeverity,
      refs: refs.refs,
      refsMore: refs.more,
      signals: signals.map((signal) => {
        const repoId = idOf.get(signal.repo.toLowerCase()) ?? null;
        const host = repoId === null ? undefined : hosts.get(repoId);
        return {
          repoId,
          repo: signal.repo,
          pr: signal.pr,
          tier: signal.tier,
          blocker: signal.blocker,
          major: signal.major,
          minor: signal.minor,
          link:
            repoId === null || host === undefined
              ? null
              : linkFor(links.get(pullKey(repoId, signal.pr)) ?? null, { id: repoId, host }),
        };
      }),
      signalsMore,
    },
    times: {
      byTier: timesByTier(rows),
      noBuildEnd: rows.filter((row) => row.buildEnd === null).length,
      notTimed: times.notTimed,
      noPullRequest: times.noPullRequest,
      reviewAgentSpansNotLinked: 0,
      usageDataAsOf: null,
    },
    factoryLoginSet: dash.factoryLogins.size > 0,
    eventsOff: eventsOffOf(data),
    skipped: {
      nightLogLines: dash.nightLog.skippedLines,
      controlEvents: dash.controls.skippedLines,
      files: dash.nightLog.skippedFiles + dash.controls.skippedFiles,
    },
    complete: incomplete.length,
    state: cachedInScope.length === 0 ? "not_connected" : "ok",
  };
}

export interface ReviewRowFilter {
  repo: string | undefined;
  /** A Risk tier, or `none` for the pull requests with no tier. */
  tier: Tier | "none" | undefined;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The total time from high to low, then the repo, then the number. */
export const compareReviewRows = (a: CursorKey, b: CursorKey): number =>
  Number(b[0]) - Number(a[0]) || byText(String(a[1]), String(b[1])) || Number(a[2]) - Number(b[2]);

export const reviewRowKey = (row: ReviewsPullRequest): CursorKey => [
  row.totalSeconds,
  row.repoId ?? row.repo,
  row.number,
];

/** One row for each timed build that has a pull request, longest total first. */
export function reviewRows(
  data: ReviewsData,
  filter: ReviewRowFilter,
  now: Date,
): ReviewsPullRequest[] {
  const { hosts, links } = data;
  const { times, recordByPull } = analyse(data, now);
  const rows = times.rows
    .filter((row) => filter.repo === undefined || row.repo.id === filter.repo)
    .map((row): ReviewsPullRequest => {
      const repoId = row.repo.id;
      const record = repoId === null ? undefined : recordByPull.get(pullKey(repoId, row.pr));
      const host = repoId === null ? undefined : hosts.get(repoId);
      return {
        repoId,
        repo: row.repo.label,
        number: row.pr,
        issue: row.issue,
        finalTier: row.finalTier,
        pathTier: record?.pathTier ?? null,
        escalated: record?.escalated ?? false,
        rounds: row.rounds,
        outcome:
          record === undefined
            ? null
            : record.settleEvent === null
              ? "not_settled"
              : record.settleEvent.decision,
        buildSeconds: row.buildSeconds,
        buildEndSource: row.buildEnd?.source ?? null,
        reviewCycleSeconds: row.reviewCycleSeconds,
        split: null,
        totalSeconds: row.totalSeconds,
        link:
          repoId === null || host === undefined
            ? null
            : linkFor(links.get(pullKey(repoId, row.pr)) ?? null, { id: repoId, host }),
      };
    })
    .filter((row) =>
      filter.tier === undefined
        ? true
        : filter.tier === "none"
          ? row.finalTier === null
          : row.finalTier === filter.tier,
    );
  return rows.sort((a, b) => compareReviewRows(reviewRowKey(a), reviewRowKey(b)));
}
