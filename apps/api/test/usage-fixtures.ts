import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

export interface Logged {
  level: "info" | "warn";
  message: string;
}

export function recordingLog() {
  const entries: Logged[] = [];
  return {
    entries,
    log: {
      info: (message: string) => entries.push({ level: "info", message }),
      warn: (message: string) => entries.push({ level: "warn", message }),
    },
  };
}

export async function makeConfigFolder(): Promise<{ claudeDir: string; dataDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "foreman-usage-"));
  return { claudeDir: path.join(root, "claude"), dataDir: path.join(root, "data") };
}

/** One synthetic assistant record. It holds fake text so tests can check that it never reaches the index. */
export function assistantLine(
  messageId: string,
  options: {
    time?: string;
    input?: number;
    output?: number;
    cwd?: string;
    session?: string;
    /** Extra tool calls of the message, for example a `Skill` call. */
    toolUses?: { id: string; name: string; input: Record<string, unknown> }[];
  } = {},
): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: options.session ?? "session-1",
    timestamp: options.time ?? "2026-11-01T10:00:00.000Z",
    cwd: options.cwd ?? "/synthetic/a/app",
    gitBranch: "feature-x",
    message: {
      id: messageId,
      model: "claude-synthetic-1",
      content: [
        { type: "text", text: "SYNTHETIC-REPLY-TEXT" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "SYNTHETIC-TOOL-INPUT" } },
        ...(options.toolUses ?? []).map((toolUse) => ({ type: "tool_use", ...toolUse })),
      ],
      usage: { input_tokens: options.input ?? 1, output_tokens: options.output ?? 2 },
    },
  });
}

/** One synthetic real user message. It holds fake text so tests can check that it never reaches the index. */
export function userLine(
  recordId: string,
  options: { time?: string; cwd?: string; session?: string } = {},
): string {
  return JSON.stringify({
    type: "user",
    uuid: recordId,
    sessionId: options.session ?? "session-1",
    timestamp: options.time ?? "2026-11-01T10:00:00.000Z",
    cwd: options.cwd ?? "/synthetic/a/app",
    gitBranch: "feature-x",
    message: { role: "user", content: "SYNTHETIC-PROMPT-TEXT" },
  });
}

/** One synthetic slash command record, as Claude Code writes it. */
export function commandLine(
  recordId: string,
  command: string,
  options: { time?: string; cwd?: string; session?: string } = {},
): string {
  return JSON.stringify({
    type: "user",
    uuid: recordId,
    sessionId: options.session ?? "session-1",
    timestamp: options.time ?? "2026-11-01T10:00:00.000Z",
    cwd: options.cwd ?? "/synthetic/a/app",
    gitBranch: "feature-x",
    message: {
      role: "user",
      content: `<command-message>${command}</command-message>\n<command-name>/${command}</command-name>\n<command-args>SYNTHETIC-ARGS</command-args>`,
    },
  });
}

/** One synthetic user record that holds only a tool result. */
export function toolResultLine(
  recordId: string,
  options: { time?: string; cwd?: string; session?: string } = {},
): string {
  return JSON.stringify({
    type: "user",
    uuid: recordId,
    sessionId: options.session ?? "session-1",
    timestamp: options.time ?? "2026-11-01T10:00:00.000Z",
    cwd: options.cwd ?? "/synthetic/a/app",
    gitBranch: "feature-x",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "SYNTHETIC-TOOL-OUTPUT" }],
    },
  });
}

export async function writeTranscript(
  claudeDir: string,
  relativePath: string,
  lines: string[],
  options: { endWithNewline?: boolean } = {},
): Promise<string> {
  const file = path.join(claudeDir, "projects", relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.join("\n") + (options.endWithNewline === false ? "" : "\n"));
  return file;
}

/** Writes a gzip-compressed copy of a transcript below `<dataDir>/archive`, as the archive hook does. */
export async function writeArchived(
  dataDir: string,
  relativePath: string,
  lines: string[],
): Promise<string> {
  const file = path.join(dataDir, "archive", `${relativePath}.gz`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, gzipSync(lines.join("\n") + "\n"), { mode: 0o600 });
  return file;
}

/** Writes the meta file of a sub-agent next to its transcript. */
export async function writeMeta(
  claudeDir: string,
  relativePath: string,
  meta: Record<string, unknown>,
): Promise<string> {
  return writeTranscript(claudeDir, relativePath, [JSON.stringify(meta)]);
}
