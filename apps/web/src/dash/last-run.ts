import { formatDate, formatTime } from "../format/index.ts";
import type { Build, BuildResult, LastRun } from "@foreman/shared";

/** One colour for each result. White text on each has a contrast of at least 4.5:1. */
export const RESULT_COLOURS: Record<BuildResult, string> = {
  merged: "#185c33",
  "merge-ready": "#0e6a74",
  "in review": "#3f2287",
  blocked: "#b45309",
  cancelled: "#8a2d2d",
  "stopped at run end": "#565d6a",
  running: "#1d4f9e",
};

export const RESULT_ORDER: BuildResult[] = [
  "merged",
  "merge-ready",
  "in review",
  "blocked",
  "cancelled",
  "stopped at run end",
  "running",
];

export interface Placed {
  build: Build;
  /** Percent of the window, 0 to 100. */
  left: number;
  width: number;
}

export interface Tick {
  at: string;
  left: number;
}

const MIN_WIDTH = 0.6;
const TICKS = 6;

export function plural(count: number, one: string, many: string): string {
  return `${count.toString()} ${count === 1 ? one : many}`;
}

/** The position of each build in its lane, as a share of the window. */
export function placeBuilds(run: LastRun): Placed[][] {
  const start = Date.parse(run.start);
  const span = Math.max(1, Date.parse(run.end) - start);
  const lanes: Placed[][] = Array.from({ length: run.lanes }, () => []);
  for (const build of run.builds) {
    const left = ((Date.parse(build.start) - start) / span) * 100;
    const right = ((Date.parse(build.end) - start) / span) * 100;
    const clamped = Math.min(Math.max(left, 0), 100 - MIN_WIDTH);
    lanes[build.lane - 1]?.push({
      build,
      left: clamped,
      width: Math.min(Math.max(right - left, MIN_WIDTH), 100 - clamped),
    });
  }
  return lanes;
}

/** Evenly spaced times on the axis, from the start to the end of the window. */
export function axisTicks(run: LastRun): Tick[] {
  const start = Date.parse(run.start);
  const span = Date.parse(run.end) - start;
  if (span <= 0) return [{ at: run.start, left: 0 }];
  return Array.from({ length: TICKS }, (_, index) => ({
    at: new Date(start + (span * index) / (TICKS - 1)).toISOString(),
    left: (index / (TICKS - 1)) * 100,
  }));
}

export const clock = (iso: string): string => formatTime(iso);

export const dayAndClock = (iso: string): string => `${formatDate(iso)} ${formatTime(iso)}`;
