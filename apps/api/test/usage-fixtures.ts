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
  options: { time?: string; input?: number; output?: number; cwd?: string; session?: string } = {},
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
      ],
      usage: { input_tokens: options.input ?? 1, output_tokens: options.output ?? 2 },
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
