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

export function reviewHealth({
  events,
  scopeRepos,
  connected,
  factoryLoginSet,
}: ReviewHealthInput): ReviewHealth {
  const inScope = events.filter(
    (event) => scopeRepos === null || scopeRepos.has(repoKey(event.repo)),
  );

  // A pull request is its repo and its number: number 7 of two repos is two pull requests.
  const firstRound = new Map<string, { tier: string | null; passed: boolean }>();
  const highestRound = new Map<string, number>();
  const waivers = new Set<string>();
  let escalations = 0;
  for (const event of inScope) {
    if (event.kind === "escalated") escalations += 1;
    if (event.kind === "waiver_used")
      waivers.add(JSON.stringify([repoKey(event.repo), event.waiver]));
    if (event.kind !== "gate") continue;
    const key = JSON.stringify([repoKey(event.repo), event.pr]);
    highestRound.set(key, Math.max(highestRound.get(key) ?? 0, event.round));
    if (event.round !== 1 || (event.decision !== "pass" && event.decision !== "fail")) continue;
    if (!firstRound.has(key)) {
      firstRound.set(key, { tier: event.tier, passed: event.decision === "pass" });
    }
  }

  const byTier = new Map<string | null, { passed: number; total: number }>();
  let passed = 0;
  for (const pull of firstRound.values()) {
    const entry = byTier.get(pull.tier) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (pull.passed) {
      entry.passed += 1;
      passed += 1;
    }
    byTier.set(pull.tier, entry);
  }
  const total = firstRound.size;

  const rounds = { one: 0, two: 0, three: 0 };
  for (const round of highestRound.values()) {
    if (round === 1) rounds.one += 1;
    else if (round === 2) rounds.two += 1;
    else rounds.three += 1;
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
