/** The cut-offs of a Limit window, in used percent. */
export const LIMIT_WARN = 70;
export const LIMIT_HIGH = 90;

export type LimitBand = "under" | "warn" | "high";

/** The state word of each band. A state always shows its word as well as its colour. */
export const LIMIT_WORDS: Record<LimitBand, string> = {
  under: "under 70%",
  warn: "70% or more",
  high: "90% or more",
};

export function limitBand(usedPercentage: number): LimitBand {
  if (usedPercentage >= LIMIT_HIGH) return "high";
  if (usedPercentage >= LIMIT_WARN) return "warn";
  return "under";
}

/** The state word of a used percentage: "under 70%", "70% or more" or "90% or more". */
export function limitWord(usedPercentage: number): string {
  return LIMIT_WORDS[limitBand(usedPercentage)];
}

/** The colour token of each band, from the theme. */
export const LIMIT_COLORS: Record<LimitBand, string> = {
  under: "var(--ok)",
  warn: "var(--warn)",
  high: "var(--danger)",
};
