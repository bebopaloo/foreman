import { UsageGrain, MAX_SERIES_BUCKETS } from "@foreman/shared";
import { addDays, daysBetween, isDay, subtractMonths, type Day } from "./days.ts";

export const METRICS = ["tokens", "turns", "estimate"] as const;
export type Metric = (typeof METRICS)[number];

/** The tabs of the page "All Projects", in the order of the table. */
export const USAGE_TABS = ["project", "model", "agentType", "skill", "branch", "session"] as const;
export type UsageTab = (typeof USAGE_TABS)[number];

const RANGE_UNITS = ["d", "w", "m"] as const;
export type RangeUnit = (typeof RANGE_UNITS)[number];

export type RangeValue =
  { kind: "relative"; count: number; unit: RangeUnit } | { kind: "absolute"; from: Day; to: Day };

export interface UsageUrlState {
  range: RangeValue;
  grain: UsageGrain;
  metric: Metric;
  tab: UsageTab;
}

export const DEFAULT_STATE: UsageUrlState = {
  range: { kind: "relative", count: 14, unit: "d" },
  grain: "day",
  metric: "tokens",
  tab: "project",
};

const RANGE_PATTERN = /^([1-9]\d{0,2})([dwm])$/;
const MAX_RANGE_COUNT = 365;

export type RelativeRange = Extract<RangeValue, { kind: "relative" }>;

export function parseRelativeRange(value: string): RelativeRange | null {
  const match = RANGE_PATTERN.exec(value);
  if (match === null) return null;
  const count = Number(match[1]);
  if (count > MAX_RANGE_COUNT) return null;
  const unit = RANGE_UNITS.find((candidate) => candidate === match[2]);
  return unit === undefined ? null : { kind: "relative", count, unit };
}

export function relativeRangeValue(range: { count: number; unit: RangeUnit }): string {
  return `${String(range.count)}${range.unit}`;
}

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null | undefined {
  if (value === null) return undefined;
  return values.find((candidate) => candidate === value) ?? null;
}

export interface ParsedUsageUrl {
  state: UsageUrlState;
  /** True when a value of the URL was not valid and the state holds the default of it. */
  invalid: boolean;
}

/**
 * Reads the values of the URL. A value that is not valid gives its default and sets `invalid`.
 * `tabs` are the tabs of the page. The first one is the default tab.
 */
export function parseUsageUrl(
  search: string,
  tabs: readonly UsageTab[] = USAGE_TABS,
): ParsedUsageUrl {
  const params = new URLSearchParams(search);
  let invalid = false;
  const defaults: UsageUrlState = { ...DEFAULT_STATE, tab: tabs[0] ?? DEFAULT_STATE.tab };

  const from = params.get("from");
  const to = params.get("to");
  let range: RangeValue | null = null;
  if (from !== null || to !== null) {
    if (from !== null && to !== null && isDay(from) && isDay(to) && from <= to) {
      range = { kind: "absolute", from, to };
    } else {
      invalid = true;
    }
  }
  if (range === null) {
    const raw = params.get("range");
    if (raw === null) range = defaults.range;
    else {
      range = parseRelativeRange(raw);
      if (range === null) {
        invalid = true;
        range = defaults.range;
      }
    }
  }

  const grain = oneOf(UsageGrain.options, params.get("grain"));
  const metric = oneOf(METRICS, params.get("metric"));
  const tab = oneOf(tabs, params.get("tab"));
  if (grain === null || metric === null || tab === null) invalid = true;

  return {
    state: {
      range,
      grain: grain ?? defaults.grain,
      metric: metric ?? defaults.metric,
      tab: tab ?? defaults.tab,
    },
    invalid,
  };
}

/**
 * The query string for a state. It keeps every other value of `search`, the Client scope included.
 * An absolute range has `from` and `to` and no `range`.
 */
export function writeUsageUrl(search: string, state: UsageUrlState): string {
  const params = new URLSearchParams(search);
  if (state.range.kind === "absolute") {
    params.delete("range");
    params.set("from", state.range.from);
    params.set("to", state.range.to);
  } else {
    params.delete("from");
    params.delete("to");
    params.set("range", relativeRangeValue(state.range));
  }
  params.set("grain", state.grain);
  params.set("metric", state.metric);
  params.set("tab", state.tab);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export interface ResolvedRange {
  from: Day;
  to: Day;
}

/** The first and last day of a range. `today` is the day in the time zone of the browser. */
export function resolveRange(range: RangeValue, today: Day): ResolvedRange {
  if (range.kind === "absolute") return { from: range.from, to: range.to };
  if (range.unit === "d") return { from: addDays(today, 1 - range.count), to: today };
  if (range.unit === "w") return { from: addDays(today, 1 - 7 * range.count), to: today };
  return { from: addDays(subtractMonths(today, range.count), 1), to: today };
}

function bucketCount(range: ResolvedRange, grain: UsageGrain): number {
  const days = daysBetween(range.from, range.to) + 1;
  if (grain === "day") return days;
  // A week or a month at each end can be partial, so the count has one more bucket.
  if (grain === "week") return Math.ceil(days / 7) + 1;
  return Math.ceil(days / 28) + 1;
}

/** The grain that the page uses. A range that needs more buckets than the API allows uses months. */
export function effectiveGrain(
  range: ResolvedRange,
  grain: UsageGrain,
): { grain: UsageGrain; tooLong: boolean } {
  if (grain !== "month" && bucketCount(range, grain) > MAX_SERIES_BUCKETS) {
    return { grain: "month", tooLong: true };
  }
  return { grain, tooLong: false };
}
