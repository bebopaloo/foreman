import { createHash } from "node:crypto";
import { type FileHandle, open, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface TranscriptFile {
  path: string;
  /** "main" for a session file, "sub-agent (unknown)" for a file below a session folder. */
  agentType: string;
}

export interface SourceScan {
  files: TranscriptFile[];
  /** Paths of the sources that do not exist. */
  missing: string[];
}

const MAIN_AGENT_TYPE = "main";
const UNKNOWN_SUB_AGENT_TYPE = "sub-agent (unknown)";
// <project folder>/<session id>.jsonl is a main session file.
const MAIN_FILE_DEPTH = 2;

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Finds the live transcripts below `<claudeDir>/projects`, and names the
 * sources that do not exist: a missing source is empty, not a failure.
 */
export async function scanSources(claudeDir: string, dataDir: string): Promise<SourceScan> {
  const projects = path.join(claudeDir, "projects");
  const missing: string[] = [];
  for (const source of [
    projects,
    path.join(dataDir, "archive"),
    path.join(dataDir, "limit-readings.jsonl"),
  ]) {
    if (!(await exists(source))) missing.push(source);
  }
  if (missing.includes(projects)) return { files: [], missing };

  const entries = await readdir(projects, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const depth = path.relative(projects, file).split(path.sep).length;
      return {
        path: file,
        agentType: depth > MAIN_FILE_DEPTH ? UNKNOWN_SUB_AGENT_TYPE : MAIN_AGENT_TYPE,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { files, missing };
}

export interface FileCursor {
  size: number;
  modifiedMs: number;
  /** The byte after the last complete line. */
  offset: number;
  /** SHA-256 of the first 4 KiB, or of all bytes before the offset when fewer. */
  headHash: string;
  /** SHA-256 of the 4 KiB before the offset. */
  tailHash: string;
}

export interface FileLines {
  lines: string[];
  cursor: FileCursor;
}

const HASH_BYTES = 4096;
const LINE_END = 0x0a;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRange(handle: FileHandle, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.max(0, end - start));
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

async function hashesBefore(handle: FileHandle, offset: number) {
  const head = await readRange(handle, 0, Math.min(HASH_BYTES, offset));
  const tail = await readRange(handle, Math.max(0, offset - HASH_BYTES), offset);
  return { headHash: sha256(head), tailHash: sha256(tail) };
}

/**
 * The complete lines of a file that are new since the cursor. The read starts
 * at the cursor offset when the size and the hashes still match, and at the
 * start of the file when they do not. A last line with no line end may be half
 * written, so it is left out and the new offset stays before it.
 */
export async function readNewLines(
  file: string,
  previous: FileCursor | undefined,
): Promise<FileLines> {
  const handle = await open(file, "r");
  try {
    const { size, mtimeMs } = await handle.stat();
    let start = 0;
    if (previous !== undefined && previous.offset <= size) {
      const hashes = await hashesBefore(handle, previous.offset);
      if (hashes.headHash === previous.headHash && hashes.tailHash === previous.tailHash) {
        start = previous.offset;
      }
    }
    const data = await readRange(handle, start, size);
    const complete = data.subarray(0, data.lastIndexOf(LINE_END) + 1);
    const offset = start + complete.length;
    const lines = complete
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    const hashes = await hashesBefore(handle, offset);
    return { lines, cursor: { size, modifiedMs: Math.trunc(mtimeMs), offset, ...hashes } };
  } finally {
    await handle.close();
  }
}
