import type { ReviewHealth } from "@foreman/shared";
import type { ControlEvent } from "./control-events.ts";

/** A connected repo in scope, with its counts of factory pull requests from the Work cache. */
export interface ConnectedRepo {
  id: string;
  /** `owner/name`. */
  label: string;
  /** Null when the Work cache has no counts for the repo. */
  factory: { reviewed: number; unreviewed: number } | null;
}

export interface ReviewHealthInput {
  /** The Control events of the last 30 days, oldest first. */
  events: readonly ControlEvent[];
  /** The repos in scope as `owner/name` in lower case, or null for all repos. */
  scopeRepos: ReadonlySet<string> | null;
  /** The connected repos in scope. */
  connected: readonly ConnectedRepo[];
  factoryLoginSet: boolean;
}

const repoKey = (repo: string): string => repo.toLowerCase();

const percent = (passed: number, total: number): number => Math.round((passed / total) * 100);

function compareTiers(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** The Control events of one pull request, reduced to the facts that the Review health numbers use. */
export interface PullRecord {
  /** `owner/name` as the first event of the pull request wrote it. */
  repo: string;
  /** `repo` in lower case. */
  repoKey: string;
  pr: number;
  /** The tier and the decision of the first round-1 `gate` event with a decision `pass` or `fail`. */
  firstRound: { tier: string | null; passed: boolean } | null;
  /** The highest `gate` round, or null with no `gate` event. */
  highestRound: number | null;
  /** The `escalated` events, oldest first. */
  escalations: { pathTier: string | null; finalTier: string | null }[];
  /** The distinct Waiver IDs of the `waiver_used` events, in the order of first use. */
  waivers: string[];
}

/**
 * One record for each pull request (its repo and its number) that has a `gate`, `escalated` or
 * `waiver_used` event in scope. The dash numbers and the review sets both read these records.
 */
export function pullRecords(
  events: readonly ControlEvent[],
  scopeRepos: ReadonlySet<string> | null,
): PullRecord[] {
  const records = new Map<string, PullRecord>();
  for (const event of events) {
    if (scopeRepos !== null && !scopeRepos.has(repoKey(event.repo))) continue;
    if (event.kind !== "gate" && event.kind !== "escalated" && event.kind !== "waiver_used") {
      continue;
    }
    // A pull request is its repo and its number: number 7 of two repos is two pull requests.
    const key = JSON.stringify([repoKey(event.repo), event.pr]);
    let record = records.get(key);
    if (record === undefined) {
      record = {
        repo: event.repo,
        repoKey: repoKey(event.repo),
        pr: event.pr,
        firstRound: null,
        highestRound: null,
        escalations: [],
        waivers: [],
      };
      records.set(key, record);
    }
    if (event.kind === "escalated") {
      record.escalations.push({ pathTier: event.path_tier, finalTier: event.tier });
    } else if (event.kind === "waiver_used") {
      if (!record.waivers.includes(event.waiver)) record.waivers.push(event.waiver);
    } else {
      record.highestRound = Math.max(record.highestRound ?? 0, event.round);
      if (
        record.firstRound === null &&
        event.round === 1 &&
        (event.decision === "pass" || event.decision === "fail")
      ) {
        record.firstRound = { tier: event.tier, passed: event.decision === "pass" };
      }
    }
  }
  return [...records.values()];
}

export function reviewHealth({
  events,
  scopeRepos,
  connected,
  factoryLoginSet,
}: ReviewHealthInput): ReviewHealth {
  const records = pullRecords(events, scopeRepos);

  const byTier = new Map<string | null, { passed: number; total: number }>();
  let passed = 0;
  let total = 0;
  for (const { firstRound } of records) {
    if (firstRound === null) continue;
    total += 1;
    const entry = byTier.get(firstRound.tier) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (firstRound.passed) {
      entry.passed += 1;
      passed += 1;
    }
    byTier.set(firstRound.tier, entry);
  }

  const rounds = { one: 0, two: 0, three: 0 };
  for (const { highestRound } of records) {
    if (highestRound === null) continue;
    if (highestRound === 1) rounds.one += 1;
    else if (highestRound === 2) rounds.two += 1;
    else rounds.three += 1;
  }

  const escalations = records.reduce((sum, record) => sum + record.escalations.length, 0);
  const waivers = new Set<string>();
  for (const record of records) {
    for (const waiver of record.waivers) waivers.add(JSON.stringify([record.repoKey, waiver]));
  }

  // The folder of a repo that has events of any kind is not "with no Control events".
  const withEvents = new Set(events.map((event) => repoKey(event.repo)));
  const reposWithoutControls = connected
    .filter((repo) => !withEvents.has(repoKey(repo.label)))
    .map((repo) => ({
      repoId: repo.id,
      repo: repo.label,
      reviewed: factoryLoginSet ? (repo.factory?.reviewed ?? null) : null,
      unreviewed: factoryLoginSet ? (repo.factory?.unreviewed ?? null) : null,
    }));

  return {
    firstRound: {
      rate: total === 0 ? null : percent(passed, total),
      passed,
      total,
      tiers: [...byTier.entries()]
        .sort(([a], [b]) => compareTiers(a, b))
        .map(([tier, counts]) => ({ tier, ...counts, rate: percent(counts.passed, counts.total) })),
    },
    rounds,
    escalations,
    waiversInUse: waivers.size,
    factoryLoginSet,
    reposWithoutControls,
  };
}
