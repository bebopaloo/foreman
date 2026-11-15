import type { DashResponse } from "@foreman/shared";

export interface NowSummary {
  headline: string;
  detail: string | null;
}

export function minutesText(ageSeconds: number): string {
  const minutes = Math.floor(ageSeconds / 60);
  return `${minutes.toString()} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The text of Now for the run state of the dash response. */
export function summariseNow(dash: DashResponse): NowSummary {
  if (dash.sources.runs === "unreadable") {
    return { headline: "cannot read the factory folder", detail: null };
  }
  const { run } = dash;
  if (run.state === "unreadable") return { headline: "run lock unreadable", detail: null };
  if (run.state === "in_progress") {
    return {
      headline: "Run in progress",
      detail:
        run.heartbeatAgeSeconds === null
          ? null
          : `heartbeat ${minutesText(run.heartbeatAgeSeconds)} ago`,
    };
  }
  return {
    headline: "No run in progress",
    detail: run.stale ? "a stopped run left a stale lock" : null,
  };
}
