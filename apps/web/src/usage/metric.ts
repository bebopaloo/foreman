import type { SeriesResponse } from "@foreman/shared";
import { formatDay, formatEstimate, formatNumber, formatTokens } from "../format/index.ts";
import type { Metric } from "./url-state/index.ts";

export const METRIC_NAMES: Record<Metric, string> = {
  tokens: "Tokens",
  turns: "Turns",
  estimate: "List-price estimate",
};

export const METRIC_FORMATS: Record<Metric, (value: number) => string> = {
  tokens: formatTokens,
  turns: formatNumber,
  estimate: formatEstimate,
};

interface Counts {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** All tokens of a row: input, output, cache write and cache read together. */
export function totalTokens(counts: Counts): number {
  return (
    counts.inputTokens + counts.outputTokens + counts.cacheWriteTokens + counts.cacheReadTokens
  );
}

type Bucket = SeriesResponse["buckets"][number];

export function metricValue(bucket: Bucket, metric: Metric): number {
  if (metric === "tokens") return totalTokens(bucket);
  if (metric === "turns") return bucket.turns;
  return bucket.estimate ?? 0;
}

/** The text of a bucket on the axis: "13 Nov", or "Nov 2026" for a month. */
export function bucketLabel(start: string, grain: string): string {
  const text = formatDay(start);
  const parts = text.split(" ");
  if (parts.length !== 3) return text;
  return grain === "month"
    ? `${parts[1] ?? ""} ${parts[2] ?? ""}`
    : `${parts[0] ?? ""} ${parts[1] ?? ""}`;
}

/** The lines for the turns that no price row matches, for example "3 turns unpriced (model x)". */
export function unpricedLines(models: readonly { model: string; turns: number }[]): string[] {
  return models.map(
    ({ model, turns }) =>
      `${formatNumber(turns)} turn${turns === 1 ? "" : "s"} unpriced (model ${model})`,
  );
}
