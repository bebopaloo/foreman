import type { ControlEvent } from "../dash/control-events.ts";
import type { Run, RunBuild, RunRepo } from "../dash/runs.ts";
import { TIERS, type GateEvent, type PullRequestRecord, type Tier } from "./pr-records.ts";

/** Where the build end comes from. A build with no build end has `buildEnd` null. */
export type BuildEndSource = "agent span" | "first gate event";

export interface BuildEnd {
  at: Date;
  source: BuildEndSource;
}

export interface BuildTimeRow {
  repo: RunRepo;
  issue: number;
  pr: number;
  finalTier: Tier | null;
  /** The highest round of the gate events of the pull request, or null with no gate event. */
  rounds: number | null;
  start: Date;
  settle: Date;
  /** From the build start to the settle, in whole seconds. */
  totalSeconds: number;
  buildEnd: BuildEnd | null;
  /** From the build start to the build end. Null with no build end. */
  buildSeconds: number | null;
  /** From the build end to the settle. Null with no build end. */
  reviewCycleSeconds: number | null;
}

export interface BuildTimes {
  rows: BuildTimeRow[];
  /** The builds with a build start and a settle that have no pull request. */
  noPullRequest: number;
  /** The builds whose start or settle is in another run. */
  notTimed: number;
}

export interface BuildTimesInput {
  runs: readonly Run[];
  events: readonly ControlEvent[];
  records: readonly PullRequestRecord[];
}

const SETTLED = new Set<RunBuild["result"]>(["merged", "merge-ready", "blocked"]);
const PR_IN_REASON = /^(?:merged|merge-ready) #(\d+)/;

const isGate = (event: ControlEvent): event is GateEvent => event.kind === "gate";

const seconds = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 1000);

function prFromReasons(reasons: readonly string[]): number | null {
  for (const reason of reasons) {
    const match = PR_IN_REASON.exec(reason);
    const digits = match?.[1];
    if (digits !== undefined) return Number.parseInt(digits, 10);
  }
  return null;
}

/**
 * The timed builds of the runs, each with its pull request and, from the Control events alone, its
 * build end. A build in two runs is one build that is not timed. A build is timed when it has a build start and a settle (`merged`, `merge-ready` or
 * `blocked`) in its run. A `cancelled` build has no row and no count. The build end here is the
 * time of the first `gate` event of the pull request in the build window; no Agent span is read.
 */
export function buildTimes(input: BuildTimesInput): BuildTimes {
  const gates = input.events.filter(isGate);
  const recordByPr = new Map(input.records.map((record) => [prKey(record), record]));
  const rows: BuildTimeRow[] = [];
  let noPullRequest = 0;
  let notTimed = 0;

  // A build that the factory resumes in a later run has a part without a settle and a part without
  // a start. The two parts are one build, so they count once.
  const unsettled = new Set<string>();
  for (const run of [...input.runs].reverse()) {
    for (const build of run.builds) {
      if (build.result === "cancelled") continue;
      const settled = SETTLED.has(build.result);
      if (!build.started || !settled) {
        const key = `${build.repo.key}\u0000${build.issue.toString()}`;
        if (build.started || !unsettled.has(key)) notTimed += 1;
        if (settled) unsettled.delete(key);
        else unsettled.add(key);
        continue;
      }
      const repoId = build.repo.id;
      const inWindow = (event: GateEvent): boolean =>
        event.repo === repoId && event.at >= build.start && event.at <= build.end;

      let pr = prFromReasons(build.reasons);
      if (pr === null && repoId !== null) {
        const newest = gates
          .filter((event) => inWindow(event) && event.issue === build.issue)
          .at(-1);
        pr = newest?.pr ?? null;
      }
      if (pr === null) {
        noPullRequest += 1;
        continue;
      }

      const firstGate = gates.find((event) => inWindow(event) && event.pr === pr);
      const buildEnd: BuildEnd | null =
        firstGate === undefined ? null : { at: firstGate.at, source: "first gate event" };
      const record = repoId === null ? undefined : recordByPr.get(prKey({ repo: repoId, pr }));
      rows.push({
        repo: build.repo,
        issue: build.issue,
        pr,
        finalTier: record?.finalTier ?? null,
        rounds: record?.rounds ?? null,
        start: build.start,
        settle: build.end,
        totalSeconds: seconds(build.start, build.end),
        buildEnd,
        buildSeconds: buildEnd === null ? null : seconds(build.start, buildEnd.at),
        reviewCycleSeconds: buildEnd === null ? null : seconds(buildEnd.at, build.end),
      });
    }
  }
  return { rows, noPullRequest, notTimed };
}

const prKey = (item: { repo: string; pr: number }): string =>
  `${item.repo}\u0000${item.pr.toString()}`;

export interface TierTimes {
  /** A final tier, or null for the pull requests with no tier. */
  tier: Tier | null;
  /** All rows of the tier. */
  pullRequests: number;
  /** The rows that the medians and the share use: build end source "agent span". */
  timed: number;
  /** In whole seconds, rounded to a whole minute. Null with no timed row. */
  medianBuildSeconds: number | null;
  medianReviewCycleSeconds: number | null;
  /** The mean of the rounds of the rows that have a gate event. Null with none. */
  meanRounds: number | null;
  /** The sum of the Review cycles over the sums of the build times and Review cycles, in whole percent. */
  reviewSharePercent: number | null;
}

/** The median of whole seconds. An even count gives the mean of the middle two. Rounded to a whole minute. */
export function medianMinutes(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return Math.round(value / 60) * 60;
}

/**
 * The times of each final tier that has rows, from `authority` to `inert`, then "no tier". The
 * medians and the review share use only the rows with the build end source "agent span": the first
 * gate event comes after the first review round, so its Review cycle leaves that round out.
 */
export function timesByTier(rows: readonly BuildTimeRow[]): TierTimes[] {
  const tiers: (Tier | null)[] = [...TIERS, null];
  return tiers.flatMap((tier) => {
    const group = rows.filter((row) => row.finalTier === tier);
    if (group.length === 0) return [];
    const timed = group.filter((row) => row.buildEnd?.source === "agent span");
    const builds = timed.map((row) => row.buildSeconds ?? 0);
    const cycles = timed.map((row) => row.reviewCycleSeconds ?? 0);
    const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
    const rounds = group.flatMap((row) => (row.rounds === null ? [] : [row.rounds]));
    const all = sum(builds) + sum(cycles);
    return [
      {
        tier,
        pullRequests: group.length,
        timed: timed.length,
        medianBuildSeconds: medianMinutes(builds),
        medianReviewCycleSeconds: medianMinutes(cycles),
        meanRounds: rounds.length === 0 ? null : sum(rounds) / rounds.length,
        reviewSharePercent: all === 0 ? null : Math.round((sum(cycles) / all) * 100),
      },
    ];
  });
}
