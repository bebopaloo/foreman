import type { ControlEvent } from "../dash/control-events.ts";
import { asTier, TIERS, type PullRequestRecord, type Tier } from "./pr-records.ts";

export type FinalTierCounts = Record<Tier, number> & { none: number };

/** The count of pull requests by final tier, with "no tier" as `none`. */
export function pullRequestsByFinalTier(records: readonly PullRequestRecord[]): FinalTierCounts {
  const counts: FinalTierCounts = { authority: 0, sensitive: 0, general: 0, inert: 0, none: 0 };
  for (const record of records) {
    if (record.finalTier === null) counts.none += 1;
    else counts[record.finalTier] += 1;
  }
  return counts;
}

export interface PathAgainstFinalCell {
  pathTier: Tier;
  finalTier: Tier;
  count: number;
  /** A cell off the diagonal holds escalated pull requests. */
  escalated: boolean;
}

export interface PathAgainstFinal {
  /** The 16 cells, the path tiers as rows and the final tiers as columns, from `authority` to `inert`. */
  cells: PathAgainstFinalCell[];
  /** The pull requests with no tier. They are not in the cells. */
  noTier: number;
}

export function pathAgainstFinalTier(records: readonly PullRequestRecord[]): PathAgainstFinal {
  const cells = TIERS.flatMap((pathTier) =>
    TIERS.map((finalTier) => ({
      pathTier,
      finalTier,
      count: 0,
      escalated: pathTier !== finalTier,
    })),
  );
  let noTier = 0;
  for (const record of records) {
    if (record.finalTier === null) {
      noTier += 1;
      continue;
    }
    const cell = cells.find(
      (candidate) =>
        candidate.pathTier === (record.pathTier ?? record.finalTier) &&
        candidate.finalTier === record.finalTier,
    );
    if (cell !== undefined) cell.count += 1;
  }
  return { cells, noTier };
}

export interface MergesByBase {
  /** A base that starts with `feature/` is `feature/*`. Each other base is as it is. */
  base: string;
  byTier: Record<Tier, number>;
  none: number;
}

/** The `merged` events by base and tier, bases in the order of their first merge. */
export function mergesByBaseAndTier(events: readonly ControlEvent[]): MergesByBase[] {
  const rows = new Map<string, MergesByBase>();
  for (const event of events) {
    if (event.kind !== "merged") continue;
    const base = event.base.startsWith("feature/") ? "feature/*" : event.base;
    const row = rows.get(base) ?? {
      base,
      byTier: { authority: 0, sensitive: 0, general: 0, inert: 0 },
      none: 0,
    };
    const tier = asTier(event.tier);
    if (tier === null) row.none += 1;
    else row.byTier[tier] += 1;
    rows.set(base, row);
  }
  return [...rows.values()];
}
