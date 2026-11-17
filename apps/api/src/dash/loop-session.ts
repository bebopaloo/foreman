import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** The text that a scheduled factory run puts in the first user message of its session. */
export const LOOP_MARKER = "[factory:unattended]";
/** Foreman reads the head of a transcript to look for the marker. */
export const LOOP_HEAD_BYTES = 64 * 1024;
/** Foreman reads the tail of a transcript to find its end. */
export const LOOP_TAIL_BYTES = 512 * 1024;
/** Foreman opens at most this many transcripts, newest first, to look for the marker. */
export const LOOP_MAX_CANDIDATES = 15;
/** A head line of this type can hold the first user message. */
const HEAD_LINES_READ = 20;
const FIRST_MESSAGE_TYPES = new Set(["user", "queue-operation"]);

export interface LoopSession {
  /** The newest write to the transcript file. */
  activityAt: Date;
  /** The time of the last message when it is an assistant message with `end_turn`, else null. */
  endedTurnAt: Date | null;
  /** The background agents that started after the last task notification. */
  agentsInFlight: number;
}

async function readBytes(file: string, start: number, length: number): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** True when the first user message in the head of the transcript holds the loop marker. */
async function hasMarker(file: string): Promise<boolean> {
  const head = await readBytes(file, 0, LOOP_HEAD_BYTES);
  // The last line can end at the byte limit. It is not complete, so it is not read.
  const lines = head.split("\n").slice(0, -1).slice(0, HEAD_LINES_READ);
  for (const line of lines) {
    const object = parseObject(line);
    const type = object?.type;
    if (typeof type !== "string" || !FIRST_MESSAGE_TYPES.has(type)) continue;
    if (line.includes(LOOP_MARKER)) return true;
    if (type === "user") return false;
  }
  return false;
}

function contentBlocks(object: Record<string, unknown>): Record<string, unknown>[] {
  const message = object.message;
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.filter(
        (block): block is Record<string, unknown> => typeof block === "object" && block !== null,
      )
    : [];
}

function isBackgroundAgent(block: Record<string, unknown>): boolean {
  if (block.type !== "tool_use" || (block.name !== "Agent" && block.name !== "Task")) return false;
  const input = block.input;
  return typeof input === "object" && input !== null && "run_in_background" in input
    ? input.run_in_background === true
    : false;
}

/** The end of the transcript: does the last message end the turn, and which agents still run. */
export async function readLoopTail(
  file: string,
  size: number,
): Promise<Pick<LoopSession, "endedTurnAt" | "agentsInFlight">> {
  const start = Math.max(0, size - LOOP_TAIL_BYTES);
  const text = await readBytes(file, start, Math.min(size, LOOP_TAIL_BYTES));
  const lines = text.split("\n");
  // A tail that starts inside a line has a partial first line.
  if (start > 0) lines.shift();
  let inFlight = 0;
  let last: { type: string; ended: boolean; at: Date | null } | null = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    const object = parseObject(line);
    if (object === null || object.isSidechain === true) continue;
    const type = object.type;
    if (type === "user" || type === "queue-operation") {
      if (line.includes("<task-notification>")) inFlight = 0;
    }
    if (type !== "user" && type !== "assistant") continue;
    const message = object.message;
    const stopReason =
      typeof message === "object" && message !== null
        ? (message as { stop_reason?: unknown }).stop_reason
        : undefined;
    const stamp = typeof object.timestamp === "string" ? new Date(object.timestamp) : null;
    last = {
      type,
      ended: type === "assistant" && stopReason === "end_turn",
      at: stamp !== null && !Number.isNaN(stamp.getTime()) ? stamp : null,
    };
    if (type === "assistant") {
      inFlight += contentBlocks(object).filter(isBackgroundAgent).length;
    }
  }
  return {
    endedTurnAt: last?.ended === true ? last.at : null,
    agentsInFlight: inFlight,
  };
}

/**
 * The newest transcript of an unattended loop session that was active since `since`. The search is
 * bounded: it lists the transcripts of every project, filters by write time, and reads the head of
 * at most 15 files and the tail of one. It returns null when no transcript matches.
 */
export async function findLoopSession(claudeDir: string, since: Date): Promise<LoopSession | null> {
  const root = path.join(claudeDir, "projects");
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return null;
  }
  const candidates: { file: string; mtimeMs: number; size: number }[] = [];
  await Promise.all(
    projects.map(async (project) => {
      let names: string[];
      try {
        names = await readdir(path.join(root, project));
      } catch {
        return;
      }
      await Promise.all(
        names
          .filter((name) => name.endsWith(".jsonl"))
          .map(async (name) => {
            const file = path.join(root, project, name);
            try {
              const info = await stat(file);
              if (info.isFile() && info.mtimeMs >= since.getTime()) {
                candidates.push({ file, mtimeMs: info.mtimeMs, size: info.size });
              }
            } catch {
              // A file that vanished is not a candidate.
            }
          }),
      );
    }),
  );
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates.slice(0, LOOP_MAX_CANDIDATES)) {
    try {
      if (!(await hasMarker(candidate.file))) continue;
      const tail = await readLoopTail(candidate.file, candidate.size);
      return {
        activityAt: new Date(candidate.mtimeMs),
        endedTurnAt:
          tail.endedTurnAt !== null && tail.endedTurnAt.getTime() >= since.getTime()
            ? tail.endedTurnAt
            : null,
        agentsInFlight: tail.agentsInFlight,
      };
    } catch {
      // A transcript that Foreman cannot read is not the loop session.
    }
  }
  return null;
}
