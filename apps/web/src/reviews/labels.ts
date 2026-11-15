import { RISK_TIERS, type ReviewsMode } from "@foreman/shared";
import { MISSING, formatDuration, formatNumber } from "../format/index.ts";

export { safeLink } from "../work/labels.ts";

export const TIERS = RISK_TIERS;

export const NO_TIER = "no tier";

export const tierName = (tier: string | null): string => tier ?? NO_TIER;

export const plural = (count: number, one: string, many: string): string =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

/** Whole minutes: "35 min" below one hour, else "1 h 25 min". */
export function formatMinutes(seconds: number | null): string {
  if (seconds === null) return MISSING;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes.toString()} min` : formatDuration(seconds);
}

export const MODE_LABELS: Record<ReviewsMode, string> = {
  round1: "Found in round 1",
  settle: "Left at settle",
};

export const OUTCOME_LABELS = {
  pass: "passed",
  blocked: "BLOCKED",
  not_settled: "not settled",
} as const;

/** "1 minor Security finding", "1 major, 2 minor Security findings". */
export function signalText(counts: { blocker: number; major: number; minor: number }): string {
  const parts = (["blocker", "major", "minor"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity].toString()} ${severity}`);
  const total = counts.blocker + counts.major + counts.minor;
  return `${parts.join(", ")} Security ${total === 1 ? "finding" : "findings"}`;
}
