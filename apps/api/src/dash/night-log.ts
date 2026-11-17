import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseLineTime, readJsonlWindow, type WindowRead } from "./jsonl-window.ts";

export const ISSUE_STATES = [
  "TODO",
  "READY",
  "IN PROGRESS",
  "IN REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const;
const IssueState = z.enum(ISSUE_STATES);

export const LINE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const NightLogLine = z
  .object({
    run_id: z.string().min(1),
    repo: z.string(),
    issue: z.number().int().positive(),
    from: IssueState,
    to: IssueState,
    reason: z.string().max(500),
    time: z.string().regex(LINE_TIME),
    /** The pull request number. The factory writes it on some lines. */
    pr: z.number().int().positive().optional(),
  })
  .strict();

export interface NightLogEntry {
  runId: string;
  /** The repo folder, as the factory wrote it. */
  repo: string;
  issue: number;
  from: (typeof ISSUE_STATES)[number];
  to: (typeof ISSUE_STATES)[number];
  reason: string;
  /** A time in the future counts as now. */
  time: Date;
  /** The pull request number of the line, or null. */
  pr: number | null;
}

export interface NightLogRead extends Omit<WindowRead<NightLogEntry>, "items"> {
  entries: NightLogEntry[];
}

export function nightLogFolder(claudeDir: string): string {
  return path.join(claudeDir, "factory", "runs");
}

/** The valid night log lines of the last 30 days, oldest first. */
export async function readNightLog(claudeDir: string, now: Date): Promise<NightLogRead> {
  const { items, ...rest } = await readJsonlWindow(
    nightLogFolder(claudeDir),
    NightLogLine,
    (line) => parseLineTime(line.time),
    now,
  );
  const entries = items
    .map(({ item, time }) => ({
      runId: item.run_id,
      repo: item.repo,
      issue: item.issue,
      from: item.from,
      to: item.to,
      reason: item.reason,
      time,
      pr: item.pr ?? null,
    }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  return { ...rest, entries };
}

/** A lock with a heartbeat older than this is stale, as in `factory_run.py`. */
export const STALE_LOCK_SECONDS = 10_800;
const RETRY_MS = 100;

const RunLockFile = z.object({
  run_id: z.string(),
  heartbeat: z.number(),
});

export type RunLockRead =
  | { state: "none" }
  | { state: "unreadable" }
  | {
      state: "held";
      runId: string;
      /** A heartbeat in the future counts as now. */
      heartbeatAt: Date;
      ageSeconds: number;
      stale: boolean;
    };

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

type Attempt =
  { kind: "none" } | { kind: "bad" } | { kind: "ok"; runId: string; heartbeat: number };

async function readOnce(file: string): Promise<Attempt> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "none" } : { kind: "bad" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "bad" };
  }
  const parsed = RunLockFile.safeParse(json);
  return parsed.success
    ? { kind: "ok", runId: parsed.data.run_id, heartbeat: parsed.data.heartbeat }
    : { kind: "bad" };
}

/**
 * The run lock. The factory writes it in place, so a lock that is not valid is read once more
 * after 100 ms before it counts as unreadable.
 */
export async function readRunLock(
  claudeDir: string,
  now: Date,
  retryMs: number = RETRY_MS,
): Promise<RunLockRead> {
  const file = path.join(claudeDir, "factory", "run.lock");
  let attempt = await readOnce(file);
  if (attempt.kind === "bad") {
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    attempt = await readOnce(file);
  }
  if (attempt.kind === "none") return { state: "none" };
  if (attempt.kind === "bad") return { state: "unreadable" };
  const heartbeatMs = Math.min(attempt.heartbeat * 1000, now.getTime());
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - heartbeatMs) / 1000));
  return {
    state: "held",
    runId: attempt.runId,
    heartbeatAt: new Date(heartbeatMs),
    ageSeconds,
    stale: (now.getTime() - attempt.heartbeat * 1000) / 1000 > STALE_LOCK_SECONDS,
  };
}

/** The fields of a repo list entry that decide which night log lines belong to it. */
export interface RepoMatchEntry {
  id: string;
  path: string;
  owner: string | null;
  name: string | null;
}

function folderName(folder: string): string {
  const parts = folder.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? folder;
}

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

/**
 * Finds the repo of a night log line. The factory writes the absolute folder path, and an older or
 * a hand-written line can hold the repo name or `owner/name`. The path wins. A name that two repos
 * share maps to no repo, because the line cannot say which one it means.
 */
export function createRepoMatcher(
  entries: readonly RepoMatchEntry[],
): (repo: string) => string | null {
  const byPath = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  const addName = (name: string, id: string): void => {
    const key = name.toLowerCase();
    byName.set(key, (byName.get(key) ?? new Set<string>()).add(id));
  };
  for (const entry of entries) {
    const folder = trimSlash(entry.path);
    if (!byPath.has(folder)) byPath.set(folder, entry.id);
    addName(folderName(folder), entry.id);
    if (entry.name !== null) addName(entry.name, entry.id);
    if (entry.owner !== null && entry.name !== null)
      addName(`${entry.owner}/${entry.name}`, entry.id);
  }
  return (repo) => {
    const byFolder = byPath.get(trimSlash(repo));
    if (byFolder !== undefined) return byFolder;
    const ids = byName.get(trimSlash(repo).toLowerCase());
    return ids?.size === 1 ? ([...ids][0] ?? null) : null;
  };
}
