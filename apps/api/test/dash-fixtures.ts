import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A fixed clock for the dash tests. */
export const NOW = new Date("2026-11-15T12:00:00Z");

export function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function minutesAgo(minutes: number, now: Date = NOW): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

export async function makeFactoryDir(): Promise<{ claudeDir: string; factory: string }> {
  const claudeDir = await mkdtemp(path.join(os.tmpdir(), "foreman-dash-"));
  const factory = path.join(claudeDir, "factory");
  await mkdir(factory, { recursive: true });
  return { claudeDir, factory };
}

export function nightLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: "run-1",
    repo: "/synthetic/acme/app",
    issue: 12,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: isoSeconds(minutesAgo(30)),
    ...over,
  };
}

export function gateEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "gate",
    repo: "acme/app",
    time: isoSeconds(minutesAgo(30)),
    pr: 40,
    issue: 12,
    tier: "general",
    round: 1,
    decision: "pass",
    counts: {},
    categories: [],
    refs: [],
    waived: [],
    ...over,
  };
}

/** Writes lines to `factory/<folder>/<date>.jsonl`. Text lines go in as they are. */
export async function writeJsonl(
  factory: string,
  folder: "runs" | "controls",
  date: string,
  lines: (Record<string, unknown> | string)[],
  options: { lineEnd?: boolean } = {},
): Promise<void> {
  await mkdir(path.join(factory, folder), { recursive: true });
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line)));
  await writeFile(
    path.join(factory, folder, `${date}.jsonl`),
    text.join("\n") + (options.lineEnd === false ? "" : "\n"),
  );
}

export async function writeLock(factory: string, lock: unknown): Promise<void> {
  await writeFile(
    path.join(factory, "run.lock"),
    typeof lock === "string" ? lock : JSON.stringify(lock),
  );
}

/** The text that marks the session of an unattended run. */
const LOOP_PROMPT = "<scheduled-task>\n[factory:unattended]\nRun the loop.\n</scheduled-task>";

export function transcriptUser(at: Date, text: string = LOOP_PROMPT): Record<string, unknown> {
  return {
    type: "user",
    timestamp: at.toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

export function transcriptAssistant(
  at: Date,
  stopReason: "end_turn" | "tool_use",
  blocks: Record<string, unknown>[] = [{ type: "text", text: "Done." }],
): Record<string, unknown> {
  return {
    type: "assistant",
    timestamp: at.toISOString(),
    message: { role: "assistant", stop_reason: stopReason, content: blocks },
  };
}

export function backgroundAgent(): Record<string, unknown> {
  return {
    type: "tool_use",
    id: "toolu_1",
    name: "Agent",
    input: { prompt: "build", run_in_background: true },
  };
}

/** Writes a session transcript to `projects/<project>/<name>.jsonl` and sets its write time. */
export async function writeTranscript(
  claudeDir: string,
  options: {
    project?: string;
    name: string;
    lines: (Record<string, unknown> | string)[];
    mtime: Date;
  },
): Promise<string> {
  const folder = path.join(claudeDir, "projects", options.project ?? "-synthetic");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${options.name}.jsonl`);
  const text = options.lines.map((line) =>
    typeof line === "string" ? line : JSON.stringify(line),
  );
  await writeFile(file, `${text.join("\n")}\n`);
  await utimes(file, options.mtime, options.mtime);
  return file;
}

/** Writes the run summary `runs/<date>-<run id>.md`. */
export async function writeSummary(factory: string, date: string, runId: string): Promise<void> {
  await mkdir(path.join(factory, "runs"), { recursive: true });
  await writeFile(path.join(factory, "runs", `${date}-${runId}.md`), "# Summary\n");
}
