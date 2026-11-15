import { createHash } from "node:crypto";
import { type FileHandle, open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { type AgentMeta, parseAgentMeta } from "./parse.ts";

const gunzipAsync = promisify(gunzip);

export interface TranscriptFile {
  path: string;
  /** "main" for a session file, "sub-agent (unknown)" for a file below a session folder. */
  agentType: string;
  /** True for a gzip file of the Transcript archive. */
  compressed: boolean;
  /** For a sub-agent file only: the agent ID and the session ID that its path gives. */
  agent?: { agentId: string; sessionId: string };
}

export interface SourceScan {
  files: TranscriptFile[];
  /** Paths of the sources that do not exist. */
  missing: string[];
}

const MAIN_AGENT_TYPE = "main";
export const UNKNOWN_SUB_AGENT_TYPE = "sub-agent (unknown)";
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

const ARCHIVE_SUFFIX = ".jsonl.gz";

async function findFiles(
  root: string,
  suffix: string,
  compressed: boolean,
): Promise<TranscriptFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const parts = path.relative(root, file).split(path.sep);
      if (parts.length <= MAIN_FILE_DEPTH) {
        return { path: file, agentType: MAIN_AGENT_TYPE, compressed };
      }
      const agentId = entry.name.slice(0, -suffix.length).replace(/^agent-/, "");
      return {
        path: file,
        agentType: UNKNOWN_SUB_AGENT_TYPE,
        compressed,
        agent: { agentId, sessionId: parts[1] ?? "" },
      };
    });
}

/**
 * Finds the live transcripts below `<claudeDir>/projects` and the compressed
 * transcripts below `<dataDir>/archive`, and names the sources that do not
 * exist: a missing source is empty, not a failure.
 */
export async function scanSources(claudeDir: string, dataDir: string): Promise<SourceScan> {
  const projects = path.join(claudeDir, "projects");
  const archive = path.join(dataDir, "archive");
  const missing: string[] = [];
  for (const source of [projects, archive, path.join(dataDir, "limit-readings.jsonl")]) {
    if (!(await exists(source))) missing.push(source);
  }
  const files = [
    ...(missing.includes(projects) ? [] : await findFiles(projects, ".jsonl", false)),
    ...(missing.includes(archive) ? [] : await findFiles(archive, ARCHIVE_SUFFIX, true)),
  ].sort((a, b) => a.path.localeCompare(b.path));
  return { files, missing };
}

/**
 * Reads the meta file next to a sub-agent transcript. A missing, unreadable or
 * invalid meta file gives an empty result: the agent type stays unknown.
 */
export async function readAgentMeta(file: TranscriptFile): Promise<AgentMeta> {
  const suffix = file.compressed ? ARCHIVE_SUFFIX : ".jsonl";
  const metaPath = `${file.path.slice(0, -suffix.length)}.meta.json${file.compressed ? ".gz" : ""}`;
  try {
    const bytes = await readFile(metaPath);
    const text = (file.compressed ? await gunzipAsync(bytes) : bytes).toString("utf8");
    return parseAgentMeta(text);
  } catch {
    return {};
  }
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

/**
 * The complete lines of a compressed archive file. The file is read in full
 * when its size or time changed, and not at all when they did not. The hashes
 * stay empty: the size and the time are the check for a compressed file.
 */
export async function readArchiveLines(
  file: string,
  previous: FileCursor | undefined,
): Promise<FileLines> {
  const handle = await open(file, "r");
  try {
    const { size, mtimeMs } = await handle.stat();
    const modifiedMs = Math.trunc(mtimeMs);
    const cursor = { size, modifiedMs, offset: size, headHash: "", tailHash: "" };
    if (previous?.size === size && previous.modifiedMs === modifiedMs) {
      return { lines: [], cursor };
    }
    const data = await gunzipAsync(await readRange(handle, 0, size));
    const lines = data
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    return { lines, cursor };
  } finally {
    await handle.close();
  }
}
