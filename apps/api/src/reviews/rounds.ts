import { TIERS, type PullRequestRecord, type Tier } from "./pr-records.ts";

export interface RoundsRow {
  /** A final tier, or null for the pull requests with no tier. */
  tier: Tier | null;
  pullRequests: number;
  /** Settled with a `pass` in round 1, 2 and 3. */
  settledInRound: [number, number, number];
  blocked: number;
  notSettled: number;
  /** The pull requests with a decision event. */
  withDecision: number;
  /** The share of `pass` among their last decision events, in whole percent. Null with no decision event. */
  lastGatePassPercent: number | null;
}

/**
 * The rounds to settle for each final tier that has pull requests, from `authority` to `inert`, then
 * "no tier". A `wait` event is not a decision, so a pull request with only `wait` events is not
 * settled and is not in the last-gate pass rate.
 */
export function roundsToSettle(records: readonly PullRequestRecord[]): RoundsRow[] {
  const tiers: (Tier | null)[] = [...TIERS, null];
  return tiers.flatMap((tier) => {
    const group = records.filter((record) => record.finalTier === tier);
    if (group.length === 0) return [];
    const settledInRound: [number, number, number] = [0, 0, 0];
    let blocked = 0;
    let notSettled = 0;
    let withDecision = 0;
    let passed = 0;
    for (const record of group) {
      const settle = record.settleEvent;
      if (record.lastDecisionEvent !== null) withDecision += 1;
      if (settle === null) {
        notSettled += 1;
      } else if (settle.decision === "blocked") {
        blocked += 1;
      } else {
        passed += 1;
        settledInRound[settle.round - 1] = (settledInRound[settle.round - 1] ?? 0) + 1;
      }
    }
    return [
      {
        tier,
        pullRequests: group.length,
        settledInRound,
        blocked,
        notSettled,
        withDecision,
        lastGatePassPercent: withDecision === 0 ? null : Math.round((passed / withDecision) * 100),
      },
    ];
  });
}
