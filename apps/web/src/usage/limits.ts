import type { LimitsResponse } from "@foreman/shared";
import { formatDate, formatTime } from "../format/index.ts";
import type { LimitPoint } from "../charts/index.ts";
import { LIMIT_HIGH } from "../thresholds/index.ts";

export type LimitWindowName = "five_hour" | "seven_day";

export const LIMIT_WINDOWS: readonly { key: LimitWindowName; name: string }[] = [
  { key: "five_hour", name: "5-hour" },
  { key: "seven_day", name: "7-day" },
];

/** The "to" of the limits request. A range that ends today also asks for the window that runs now. */
export function limitsTo(rangeTo: string, today: string, plusSevenDays: string): string {
  return rangeTo === today ? plusSevenDays : rangeTo;
}

/** "13 Nov": the date of a time in the browser's time zone, with no year. */
function shortDate(time: string): string {
  return formatDate(time).split(" ").slice(0, 2).join(" ");
}

export interface LimitSeries {
  points: LimitPoint[];
  /** The count of windows in the range, the window in progress included. */
  total: number;
  /** The count of those windows whose peak is 90% or more. */
  reachedHigh: number;
}

/**
 * The bars of one Limit window: the past windows of the range, and the window that runs now. The
 * API lists a window once it has reset. The window in progress comes from the latest reading when
 * the range reaches today, because a used percentage only grows inside a window, so the latest
 * reading is the peak so far.
 */
export function limitSeries(
  response: LimitsResponse,
  window: LimitWindowName,
  now: Date,
  includesToday: boolean,
): LimitSeries {
  const entries = response.windows
    .filter((entry) => entry.window === window)
    .map((entry) => ({ resetsAt: entry.resetsAt, peak: entry.peakUsedPercentage }));
  const running = entries.some((entry) => new Date(entry.resetsAt) > now);
  const latest = response.latest[window];
  if (!running && includesToday && latest !== null && new Date(latest.resetsAt) > now) {
    entries.push({ resetsAt: latest.resetsAt, peak: latest.usedPercentage });
  }
  entries.sort((a, b) => a.resetsAt.localeCompare(b.resetsAt));
  const points = entries.map((entry): LimitPoint => {
    const inProgress = new Date(entry.resetsAt) > now;
    const when = `${formatDate(entry.resetsAt)} ${formatTime(entry.resetsAt)}`;
    return {
      label: inProgress
        ? "in progress"
        : window === "five_hour"
          ? `${shortDate(entry.resetsAt)} ${formatTime(entry.resetsAt)}`
          : shortDate(entry.resetsAt),
      description: `Resets ${when}`,
      value: entry.peak,
      inProgress,
    };
  });
  return {
    points,
    total: points.length,
    reachedHigh: points.filter((point) => point.value >= LIMIT_HIGH).length,
  };
}
