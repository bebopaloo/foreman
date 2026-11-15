import type { ControlEvent } from "../dash/control-events.ts";
import type { Run, RunBuild, RunRepo } from "../dash/runs.ts";
import type { AgentSpan } from "../sessions/spans.ts";
import { TIERS, type GateEvent, type PullRequestRecord, type Tier } from "./pr-records.ts";

/** Where the build end comes from. A build with no build end has `buildEnd` null. */
export type BuildEndSource = "agent span" | "first gate event";

export interface BuildEnd {
  at: Date;
  source: BuildEndSource;
}

/** The time of a Review cycle by what ran in it, in whole seconds. The three parts add up to the cycle. */
export interface ReviewSplit {
  reviewAgentsSeconds: number;
  resolverSeconds: number;
  otherSeconds: number;
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
  /** Null with no build end, or with no linked review or resolver Agent span. */
  split: ReviewSplit | null;
}

export interface BuildTimes {
  rows: BuildTimeRow[];
  /** The builds with a build start and a settle that have no pull request. */
  noPullRequest: number;
  /** The builds whose start or settle is in another run. */
  notTimed: number;
  /** The review Agent spans that have no work item, or two or more, so they link to no build. */
  reviewAgentSpansNotLinked: number;
}

export interface BuildTimesInput {
  runs: readonly Run[];
  events: readonly ControlEvent[];
  records: readonly PullRequestRecord[];
  /** The sub-agent spans that may link to a build. Default: none. */
  spans?: readonly AgentSpan[];
  /** The `RunRepo.key` of a Project key: the repo ID of a listed repo, else the Project key itself. */
  repoKeyOf?: (projectKey: string) => string;
}

type Role = "developer" | "review" | "resolver";

const ROLES: Readonly<Record<string, Role>> = {
  "software-developer": "developer",
  "review-finder": "review",
  "review-verifier": "review",
  "review-resolver": "resolver",
};
const FACTORY_PREFIX = "factory-core:";

function roleOf(agentType: string): Role | null {
  const name = agentType.startsWith(FACTORY_PREFIX)
    ? agentType.slice(FACTORY_PREFIX.length)
    : agentType;
  return Object.hasOwn(ROLES, name) ? (ROLES[name] ?? null) : null;
}

interface LinkedSpan {
  span: AgentSpan;
  role: Role;
}

const itemKey = (repoKey: string, issue: number): string => `${repoKey}\u0000${issue.toString()}`;

/**
 * The spans of the four Agent types, by repo and work item. A span links to a work item when all
 * its Turns that name one name the same one in the same repo. Also the count of review spans that
 * have no single work item.
 */
function indexSpans(
  spans: readonly AgentSpan[],
  repoKeyOf: (projectKey: string) => string,
): { byItem: Map<string, LinkedSpan[]>; notLinked: number } {
  const byItem = new Map<string, LinkedSpan[]>();
  let notLinked = 0;
  for (const span of spans) {
    const role = roleOf(span.agentType);
    if (role === null || span.kind !== "sub-agent") continue;
    const items = new Set(
      span.workRefs.map((ref) => itemKey(repoKeyOf(ref.projectKey), ref.number)),
    );
    const [only] = items;
    if (items.size !== 1 || only === undefined) {
      if (role !== "developer") notLinked += 1;
      continue;
    }
    byItem.set(only, [...(byItem.get(only) ?? []), { span, role }]);
  }
  return { byItem, notLinked };
}

type Interval = readonly [number, number];

/** The union of intervals, as sorted intervals that do not touch. */
function union(intervals: readonly Interval[]): Interval[] {
  const merged: [number, number][] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

const lengthOf = (intervals: readonly Interval[]): number =>
  intervals.reduce((sum, [from, to]) => sum + (to - from), 0);

const clip = (span: AgentSpan, from: number, to: number): Interval[] => {
  const start = Math.max(span.start.getTime(), from);
  const end = Math.min(span.end.getTime(), to);
  return end > start ? [[start, end]] : [];
};

/**
 * The split of the Review cycle from `from` to `to`. Review agents: the time that a review span
 * covers. Resolver: the time that a resolver span covers and no review span covers. Other: the rest.
 * Null with no linked review or resolver span.
 */
function splitCycle(from: Date, to: Date, linked: readonly LinkedSpan[]): ReviewSplit | null {
  const reviews = linked.filter((item) => item.role === "review");
  const resolvers = linked.filter((item) => item.role === "resolver");
  if (reviews.length + resolvers.length === 0) return null;
  const [a, b] = [from.getTime(), to.getTime()];
  const review = union(reviews.flatMap(({ span }) => clip(span, a, b)));
  const both = union([...review, ...resolvers.flatMap(({ span }) => clip(span, a, b))]);
  const reviewAgentsSeconds = Math.round(lengthOf(review) / 1000);
  const resolverSeconds = Math.round((lengthOf(both) - lengthOf(review)) / 1000);
  const cycle = seconds(from, to);
  return {
    reviewAgentsSeconds,
    resolverSeconds,
    otherSeconds: Math.max(0, cycle - reviewAgentsSeconds - resolverSeconds),
  };
}

const SETTLED = new Set<RunBuild["result"]>(["merged", "merge-ready", "blocked"]);
const PR_IN_REASON = /^(?:merged|merge-ready) #(\d+)/;

const isGate = (event: ControlEvent): event is GateEvent => event.kind === "gate";

const seconds = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 1000);

const repoName = (repo: RunRepo): string | null =>
  repo.id === null ? null : repo.label.toLowerCase();

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
 * build end and the split of its Review cycle. A build in two runs is one build that is not timed. A
 * build is timed when it has a build start and a settle (`merged`, `merge-ready` or `blocked`) in
 * its run. A `cancelled` build has no row and no count. The build end is the last Turn of the last
 * linked `software-developer` span, else the first `gate` event of the pull request in the build
 * window. Control events know a repo by `owner/name`, a build by its repo ID, so the label of a
 * listed repo joins them.
 */
export function buildTimes(input: BuildTimesInput): BuildTimes {
  const gates = input.events.filter(isGate);
  const recordByPr = new Map(input.records.map((record) => [prKey(record), record]));
  const { byItem, notLinked } = indexSpans(input.spans ?? [], input.repoKeyOf ?? ((key) => key));
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
      const name = repoName(build.repo);
      const inWindow = (event: GateEvent): boolean =>
        name !== null &&
        event.repo.toLowerCase() === name &&
        event.at >= build.start &&
        event.at <= build.end;

      let pr = prFromReasons(build.reasons);
      if (pr === null && name !== null) {
        const newest = gates
          .filter((event) => inWindow(event) && event.issue === build.issue)
          .at(-1);
        pr = newest?.pr ?? null;
      }
      if (pr === null) {
        noPullRequest += 1;
        continue;
      }

      const linked = (byItem.get(itemKey(build.repo.key, build.issue)) ?? []).filter(
        ({ span }) => span.start >= build.start && span.start <= build.end,
      );
      const developerEnd = linked
        .filter((item) => item.role === "developer")
        .sort((a, b) => a.span.start.getTime() - b.span.start.getTime())
        .at(-1)?.span.end;
      const firstGate = gates.find((event) => inWindow(event) && event.pr === pr);
      const buildEnd: BuildEnd | null =
        developerEnd !== undefined && developerEnd <= build.end
          ? { at: developerEnd, source: "agent span" }
          : firstGate === undefined
            ? null
            : { at: firstGate.at, source: "first gate event" };
      const record = name === null ? undefined : recordByPr.get(prKey({ repo: name, pr }));
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
        split: buildEnd === null ? null : splitCycle(buildEnd.at, build.end, linked),
      });
    }
  }
  return { rows, noPullRequest, notTimed, reviewAgentSpansNotLinked: notLinked };
}

/** The key of a pull request by its repo (`owner/name`, any case) and number. */
export const prKey = (item: { repo: string; pr: number }): string =>
  `${item.repo.toLowerCase()}\u0000${item.pr.toString()}`;

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
