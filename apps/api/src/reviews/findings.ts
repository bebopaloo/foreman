import { z } from "zod";
import type { ControlEvent } from "../dash/control-events.ts";
import { type GateEvent, type PullRequestRecord, type Tier } from "./pr-records.ts";

export type FindingsMode = "round1" | "settle";

export const SEVERITIES = ["blocker", "major", "minor", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

const REF_LIMIT = 10;
const SIGNAL_LIMIT = 20;

const Count = z.number().int().nonnegative();
const Counts = z.record(z.string(), Count);
const Matrix = z.record(z.string(), z.partialRecord(z.enum(SEVERITIES), Count));
const Refs = z.array(z.string().min(1));

const isGate = (event: ControlEvent): event is GateEvent => event.kind === "gate";

/** The event that the mode counts, or null when the pull request has none. */
function chosenEvent(record: PullRequestRecord, mode: FindingsMode): GateEvent | null {
  return mode === "round1" ? record.roundOneEvent : record.settleEvent;
}

export type SeverityRow = Partial<Record<Tier | "none", number>> & { total: number };

export interface SecurityFindings {
  /** The `Security` row of the `matrix`, by severity and final tier, with a total for each severity. */
  bySeverity: Record<Severity, SeverityRow>;
  /** The pull requests whose chosen event has no valid `matrix`. They are not counted, not zero. */
  withoutMatrix: number;
}

/** The Security findings of the chosen events by severity and final tier. */
export function securityFindings(
  records: readonly PullRequestRecord[],
  mode: FindingsMode,
): SecurityFindings {
  const bySeverity: Record<Severity, SeverityRow> = {
    blocker: { total: 0 },
    major: { total: 0 },
    minor: { total: 0 },
    info: { total: 0 },
  };
  let withoutMatrix = 0;
  for (const record of records) {
    const event = chosenEvent(record, mode);
    if (event === null) continue;
    const matrix = Matrix.safeParse(event.matrix);
    if (!matrix.success) {
      withoutMatrix += 1;
      continue;
    }
    const security = matrix.data.Security ?? {};
    const column = record.finalTier ?? "none";
    for (const severity of SEVERITIES) {
      const count = security[severity] ?? 0;
      if (count === 0) continue;
      const row = bySeverity[severity];
      row[column] = (row[column] ?? 0) + count;
      row.total += count;
    }
  }
  return { bySeverity, withoutMatrix };
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface CategoryAndSeverityFindings {
  /** From the highest count to the lowest, then by name. */
  byCategory: NamedCount[];
  /** In the order blocker, major, minor, info, then other keys by name. */
  bySeverity: NamedCount[];
}

function addCounts(into: Map<string, number>, value: unknown): void {
  const counts = Counts.safeParse(value);
  if (!counts.success) return;
  for (const [name, count] of Object.entries(counts.data)) {
    if (count > 0) into.set(name, (into.get(name) ?? 0) + count);
  }
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The sums of `categories` and `counts` of the chosen events, in all categories. */
export function findingsByCategoryAndSeverity(
  records: readonly PullRequestRecord[],
  mode: FindingsMode,
): CategoryAndSeverityFindings {
  const categories = new Map<string, number>();
  const severities = new Map<string, number>();
  for (const record of records) {
    const event = chosenEvent(record, mode);
    if (event === null) continue;
    addCounts(categories, event.categories);
    addCounts(severities, event.counts);
  }
  const severityRank = (name: string): number => {
    const index = SEVERITIES.findIndex((severity) => severity === name);
    return index === -1 ? SEVERITIES.length : index;
  };
  return {
    byCategory: [...categories]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || byName(a.name, b.name)),
    bySeverity: [...severities]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => severityRank(a.name) - severityRank(b.name) || byName(a.name, b.name)),
  };
}

export interface RefCount {
  ref: string;
  pullRequests: number;
}

const prKey = (event: { repo: string; pr: number }): string =>
  `${event.repo}\u0000${event.pr.toString()}`;

/**
 * For each ref, the count of distinct pull requests that have it in the `refs` of one or more
 * `gate` events, in any round. The 10 highest counts come first; `more` is the count of the rest.
 */
export function mostFrequentRefs(events: readonly ControlEvent[]): {
  refs: RefCount[];
  more: number;
} {
  const pullRequestsByRef = new Map<string, Set<string>>();
  for (const event of events) {
    if (!isGate(event)) continue;
    const refs = Refs.safeParse(event.refs);
    if (!refs.success) continue;
    for (const ref of refs.data) {
      const set = pullRequestsByRef.get(ref) ?? new Set<string>();
      set.add(prKey(event));
      pullRequestsByRef.set(ref, set);
    }
  }
  const all = [...pullRequestsByRef]
    .map(([ref, set]) => ({ ref, pullRequests: set.size }))
    .sort((a, b) => b.pullRequests - a.pullRequests || byName(a.ref, b.ref));
  return { refs: all.slice(0, REF_LIMIT), more: Math.max(0, all.length - REF_LIMIT) };
}

export interface SecuritySignal {
  repo: string;
  pr: number;
  tier: "general" | "inert";
  blocker: number;
  major: number;
  minor: number;
}

/**
 * The pull requests with the final tier `general` or `inert` whose decision events have a Security
 * finding of severity `blocker`, `major` or `minor`. Each severity is the highest count in one
 * decision event. The first 20 by repo ID and number show; `more` is the count of the rest.
 */
export function securitySignals(
  events: readonly ControlEvent[],
  records: readonly PullRequestRecord[],
): { signals: SecuritySignal[]; more: number } {
  const lowTier = new Map<string, "general" | "inert">();
  for (const record of records) {
    if (record.finalTier === "general" || record.finalTier === "inert") {
      lowTier.set(prKey(record), record.finalTier);
    }
  }
  const found = new Map<string, SecuritySignal>();
  for (const event of events) {
    if (!isGate(event) || event.decision === "wait") continue;
    const tier = lowTier.get(prKey(event));
    if (tier === undefined) continue;
    const matrix = Matrix.safeParse(event.matrix);
    if (!matrix.success) continue;
    const security = matrix.data.Security ?? {};
    const signal = found.get(prKey(event)) ?? {
      repo: event.repo,
      pr: event.pr,
      tier,
      blocker: 0,
      major: 0,
      minor: 0,
    };
    signal.blocker = Math.max(signal.blocker, security.blocker ?? 0);
    signal.major = Math.max(signal.major, security.major ?? 0);
    signal.minor = Math.max(signal.minor, security.minor ?? 0);
    found.set(prKey(event), signal);
  }
  const all = [...found.values()]
    .filter((signal) => signal.blocker + signal.major + signal.minor > 0)
    .sort((a, b) => byName(a.repo, b.repo) || a.pr - b.pr);
  return { signals: all.slice(0, SIGNAL_LIMIT), more: Math.max(0, all.length - SIGNAL_LIMIT) };
}
