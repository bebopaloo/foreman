import type { DashResponse } from "@foreman/shared";

export interface NowSummary {
  headline: string;
  detail: string | null;
  /** The facts that decide the state, one sentence each. */
  evidence: string[];
  /** True when the run is stalled. */
  stalled: boolean;
}

/** The tab title starts with this text while a run is stalled. */
export const STALLED_TITLE_PREFIX = "Stalled · ";

export function isStalled(dash: DashResponse | undefined): boolean {
  return dash?.runStatus.state === "stalled";
}

function clock(iso: string): string {
  return `${iso.slice(11, 16)}Z`;
}

/** One sentence for each fact of the run status. */
export function evidenceOf(dash: DashResponse): string[] {
  const { runStatus: status } = dash;
  const lines: string[] = [];
  if (status.state === "stalled") {
    if (status.stalledBy === "end-turn" && status.loopEndedTurnAt !== null) {
      lines.push(
        `The loop session ended its turn at ${clock(status.loopEndedTurnAt)}, and no background agent runs.`,
      );
    } else if (status.quietSeconds !== null) {
      lines.push(
        `Nothing moved for ${minutesText(status.quietSeconds)}. A run is stalled after ${minutesText(status.stallAfterSeconds)}.`,
      );
    }
  }
  if (status.state === "running" || status.state === "stalled") {
    if (status.heartbeatAt !== null) lines.push(`Heartbeat at ${clock(status.heartbeatAt)}.`);
    lines.push(
      status.lastLineAt === null
        ? "The night log has no line for this run yet."
        : `Last night log line at ${clock(status.lastLineAt)}.`,
    );
    lines.push(
      status.loopActivityAt === null
        ? "Foreman found no loop session transcript."
        : `Loop session transcript last written at ${clock(status.loopActivityAt)}.`,
    );
  }
  if (status.state === "ended" || status.state === "ended-without-summary") {
    const name = status.runId ?? "the run";
    lines.push(
      status.hasSummary === true
        ? `Run ${name} ended and has a summary file.`
        : `Run ${name} ended and has no summary file.`,
    );
    if (status.lockStale) lines.push("The run left a lock with a stale heartbeat.");
  }
  return lines;
}

export function minutesText(ageSeconds: number): string {
  const minutes = Math.floor(ageSeconds / 60);
  return `${minutes.toString()} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The text of Now for the run state of the dash response. */
export function summariseNow(dash: DashResponse): NowSummary {
  if (dash.sources.runs === "unreadable") {
    return {
      headline: "cannot read the factory folder",
      detail: null,
      evidence: [],
      stalled: false,
    };
  }
  const { run } = dash;
  if (run.state === "unreadable") {
    return { headline: "run lock unreadable", detail: null, evidence: [], stalled: false };
  }
  const evidence = evidenceOf(dash);
  if (isStalled(dash)) {
    return {
      headline: "Run stalled",
      detail:
        dash.runStatus.stalledBy === "end-turn"
          ? "the loop session stopped"
          : `no activity for ${minutesText(dash.runStatus.quietSeconds ?? 0)}`,
      evidence,
      stalled: true,
    };
  }
  if (run.state === "in_progress") {
    return {
      evidence,
      stalled: false,
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
    evidence,
    stalled: false,
  };
}
