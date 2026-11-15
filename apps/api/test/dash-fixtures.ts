import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
