import { readdir, readFile, stat } from "node:fs/promises";
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

export interface FileLines {
  lines: string[];
}

/**
 * The complete lines of a file. A last line with no line end may be half
 * written, so it is left out.
 */
export async function readCompleteLines(file: string): Promise<FileLines> {
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  lines.pop();
  return { lines: lines.filter((line) => line.trim() !== "") };
}
