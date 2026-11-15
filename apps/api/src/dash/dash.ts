import type { DashResponse } from "@foreman/shared";
import { readControlEvents, type ControlEventsRead } from "./control-events.ts";
import type { SkippedFile } from "./jsonl-window.ts";
import { readNightLog, readRunLock, type NightLogRead, type RunLockRead } from "./night-log.ts";

export interface DashSources {
  nightLog: NightLogRead;
  lock: RunLockRead;
  controls: ControlEventsRead;
}

export interface DashRead {
  response: DashResponse;
  /** The files with skipped lines: the log shows the names and the counts, never a line. */
  reports: { folder: "runs" | "controls"; files: SkippedFile[] }[];
}

export async function readDashSources(claudeDir: string, now: Date): Promise<DashSources> {
  const [nightLog, lock, controls] = await Promise.all([
    readNightLog(claudeDir, now),
    readRunLock(claudeDir, now),
    readControlEvents(claudeDir, now),
  ]);
  return { nightLog, lock, controls };
}

function runOf(lock: RunLockRead): DashResponse["run"] {
  if (lock.state === "unreadable") {
    return { state: "unreadable", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null };
  }
  if (lock.state === "none") {
    return { state: "none", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null };
  }
  return {
    state: lock.stale ? "none" : "in_progress",
    stale: lock.stale,
    heartbeatAt: lock.heartbeatAt.toISOString(),
    heartbeatAgeSeconds: lock.ageSeconds,
  };
}

export function buildDash({ nightLog, lock, controls }: DashSources): DashRead {
  return {
    response: {
      run: runOf(lock),
      sources: { runs: nightLog.folder, controls: controls.folder },
      skipped: {
        nightLogLines: nightLog.skippedLines,
        controlEvents: controls.skippedLines,
        files: nightLog.skippedFiles + controls.skippedFiles,
        lock: lock.state === "unreadable" ? 1 : 0,
      },
    },
    reports: [
      { folder: "runs", files: nightLog.reports },
      { folder: "controls", files: controls.reports },
    ],
  };
}
