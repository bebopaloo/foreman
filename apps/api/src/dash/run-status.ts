import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RunStatus } from "@foreman/shared";
import { findLoopSession, type LoopSession } from "./loop-session.ts";
import { nightLogFolder, type NightLogEntry, type RunLockRead } from "./night-log.ts";

/** A held run with no activity for this long is stalled. */
export const STALL_AFTER_SECONDS = 20 * 60;
/** With no night log line for the run, Foreman looks for a loop session this far back. */
export const LOOP_LOOKBACK_MS = 12 * 60 * 60 * 1000;

export interface RunStatusInput {
  lock: RunLockRead;
  /** Every night log line of the window, oldest first, in all scopes. */
  entries: readonly NightLogEntry[];
  /** The loop session of the held run, or null. */
  loop: LoopSession | null;
  /** True when the file `<date>-<run id>.md` exists for the run. */
  hasSummary: boolean;
  now: Date;
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** The first night log line time of a run. The loop session search starts here. */
export function runStartOf(runId: string, entries: readonly NightLogEntry[]): Date | null {
  return entries.find((entry) => entry.runId === runId)?.time ?? null;
}

/** The run that the status describes: the run of the lock, else the newest run of the night log. */
export function statusRunId(lock: RunLockRead, entries: readonly NightLogEntry[]): string | null {
  if (lock.state === "held") return lock.runId;
  return entries[entries.length - 1]?.runId ?? null;
}

/** The time since which a loop session counts for the run. */
export function loopSince(runId: string, entries: readonly NightLogEntry[], now: Date): Date {
  return runStartOf(runId, entries) ?? new Date(now.getTime() - LOOP_LOOKBACK_MS);
}

export function computeRunStatus(input: RunStatusInput): RunStatus {
  const { lock, entries, loop, now } = input;
  const base = {
    lockStale: false,
    stalledBy: null,
    heartbeatAt: null,
    lastLineAt: null,
    loopActivityAt: null,
    loopEndedTurnAt: null,
    agentsInFlight: null,
    quietSeconds: null,
    stallAfterSeconds: STALL_AFTER_SECONDS,
    hasSummary: null,
  } satisfies Omit<RunStatus, "state" | "runId">;
  if (lock.state === "unreadable") return { ...base, state: "unreadable", runId: null };
  const runId = statusRunId(lock, entries);
  if (runId === null) return { ...base, state: "none", runId: null };
  const lastLine = entries.findLast((entry) => entry.runId === runId)?.time ?? null;

  if (lock.state !== "held" || lock.stale) {
    return {
      ...base,
      state: input.hasSummary ? "ended" : "ended-without-summary",
      runId,
      lockStale: lock.state === "held",
      heartbeatAt: lock.state === "held" ? iso(lock.heartbeatAt) : null,
      lastLineAt: iso(lastLine),
      hasSummary: input.hasSummary,
    };
  }

  const times = [lock.heartbeatAt, lastLine, loop?.activityAt ?? null].filter(
    (time): time is Date => time !== null,
  );
  const newest = Math.max(...times.map((time) => time.getTime()));
  const quietSeconds = Math.max(0, Math.floor((now.getTime() - newest) / 1000));
  const ended = loop !== null && loop.endedTurnAt !== null && loop.agentsInFlight === 0;
  const stalledBy = ended ? "end-turn" : quietSeconds > STALL_AFTER_SECONDS ? "quiet" : null;
  return {
    ...base,
    state: stalledBy === null ? "running" : "stalled",
    runId,
    stalledBy,
    heartbeatAt: iso(lock.heartbeatAt),
    lastLineAt: iso(lastLine),
    loopActivityAt: iso(loop?.activityAt ?? null),
    loopEndedTurnAt: iso(loop?.endedTurnAt ?? null),
    agentsInFlight: loop?.agentsInFlight ?? null,
    quietSeconds,
  };
}

/** True when the runs folder holds a summary file `<date>-<run id>.md` for the run. */
export async function runHasSummary(claudeDir: string, runId: string): Promise<boolean> {
  try {
    const names = await readdir(nightLogFolder(claudeDir));
    return names.some((name) => name.endsWith(`-${runId}.md`) && !name.includes(path.sep));
  } catch {
    return false;
  }
}

/** Reads the loop session or the summary file that the state needs, then decides the state. */
export async function readRunStatus(
  claudeDir: string,
  lock: RunLockRead,
  entries: readonly NightLogEntry[],
  now: Date,
): Promise<RunStatus> {
  const runId = statusRunId(lock, entries);
  const held = lock.state === "held" && !lock.stale;
  const [loop, hasSummary] = await Promise.all([
    held && runId !== null ? findLoopSession(claudeDir, loopSince(runId, entries, now)) : null,
    !held && runId !== null ? runHasSummary(claudeDir, runId) : false,
  ]);
  return computeRunStatus({ lock, entries, loop, hasSummary, now });
}
