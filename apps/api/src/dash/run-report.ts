import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RUN_SLOT_LIMIT, type RunReportResponse } from "@foreman/shared";
import { z } from "zod";
import { readControlEvents, type ControlEvent } from "./control-events.ts";
import { parseLineTime, readJsonlWindow } from "./jsonl-window.ts";
import { LINE_TIME, nightLogFolder } from "./night-log.ts";

/** A summary file larger than this is cut. */
const MAX_SUMMARY_BYTES = 200 * 1024;
const MINUTE_MS = 60_000;

/**
 * A tolerant night log line: an extra key such as `pr` is allowed, and `repo` can be a folder or a
 * bare name. This reader does not depend on the shared night log mapping.
 */
const RunLogLine = z.looseObject({
  run_id: z.string().min(1),
  repo: z.string(),
  issue: z.number().int().positive(),
  from: z.string(),
  to: z.string(),
  reason: z.string().max(500),
  time: z.string().regex(LINE_TIME),
  pr: z.number().int().positive().optional(),
});

export interface ReportEntry {
  repo: string;
  issue: number;
  from: string;
  to: string;
  reason: string;
  time: Date;
  pr: number | null;
}

export interface ReportInput {
  runId: string;
  /** The lines of this run only, oldest first. */
  entries: readonly ReportEntry[];
  events: readonly ControlEvent[];
  summary: { file: string; text: string } | null;
  skippedLines: number;
}

/** The last part of a folder or of `owner/name`, in lower case: the key that joins the two sources. */
export function repoKey(repo: string): string {
  const parts = repo.split("/").filter((part) => part.length > 0);
  return (parts[parts.length - 1] ?? repo).toLowerCase();
}

const iso = (date: Date): string => date.toISOString();
const isSkip = (entry: ReportEntry): boolean => entry.from === "READY" && entry.to === "READY";
const MERGED = /^merged #(\d+)/;
const BLOCKED_BY = /^blocked by (#\d+(?:\s*,\s*#\d+)*)\s*$/;
const ALL_CHILDREN_DONE = "every child issue is DONE";

function countsOf(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, count] of Object.entries(value)) {
      if (typeof count === "number" && Number.isInteger(count)) counts[key] = count;
    }
  }
  return counts;
}

function mergesOf(entries: readonly ReportEntry[], events: readonly ControlEvent[]) {
  return entries.flatMap((entry) => {
    if (entry.to !== "DONE") return [];
    const match = MERGED.exec(entry.reason);
    if (match === null) return [];
    const pr = Number(match[1]) || entry.pr;
    const key = repoKey(entry.repo);
    const same = events.filter(
      (event) => "pr" in event && event.pr === pr && repoKey(event.repo) === key,
    );
    const merged = same.find((event) => event.kind === "merged");
    // The events are oldest first: the last gate event is the final one.
    const gate = same.filter((event) => event.kind === "gate").at(-1);
    return [
      {
        time: iso(entry.time),
        repo: entry.repo,
        issue: entry.issue,
        pr: pr ?? null,
        tier:
          (merged?.kind === "merged" ? merged.tier : null) ??
          (gate?.kind === "gate" ? gate.tier : null),
        round: gate?.kind === "gate" ? gate.round : null,
        counts: gate?.kind === "gate" ? countsOf(gate.counts) : {},
      },
    ];
  });
}

function skipsOf(entries: readonly ReportEntry[]): RunReportResponse["skips"] {
  const skips = entries.filter(isSkip);
  const groups = new Map<string, { repo: string; blocker: number; issues: number[] }>();
  const other: RunReportResponse["skips"]["other"] = [];
  for (const skip of skips) {
    const list = BLOCKED_BY.exec(skip.reason)?.[1];
    if (list === undefined) {
      other.push({ repo: skip.repo, issue: skip.issue, reason: skip.reason });
      continue;
    }
    for (const blocker of list.split(",").map((part) => Number(part.trim().slice(1)))) {
      const key = `${repoKey(skip.repo)}#${blocker.toString()}`;
      const group = groups.get(key) ?? { repo: skip.repo, blocker, issues: [] };
      if (!group.issues.includes(skip.issue)) group.issues.push(skip.issue);
      groups.set(key, group);
    }
  }
  const byBlocker = [...groups.values()]
    .map((group) => ({ ...group, issues: group.issues.sort((a, b) => a - b) }))
    .sort((a, b) => b.issues.length - a.issues.length || a.blocker - b.blocker);
  return { total: skips.length, byBlocker, other };
}

interface BuildSpan {
  start: number;
  end: number;
}

/**
 * A build runs from the first IN PROGRESS line of an issue to its first DONE, BLOCKED, CANCELLED or
 * merge-ready line. A build with no end runs to the end of the run. An issue that settled with
 * "every child issue is DONE" is a Spec issue: it is not a build.
 */
function buildSpans(entries: readonly ReportEntry[], runEnd: number): BuildSpan[] {
  const byIssue = new Map<string, ReportEntry[]>();
  for (const entry of entries) {
    if (isSkip(entry)) continue;
    const key = `${repoKey(entry.repo)}#${entry.issue.toString()}`;
    byIssue.set(key, [...(byIssue.get(key) ?? []), entry]);
  }
  const spans: BuildSpan[] = [];
  for (const lines of byIssue.values()) {
    if (lines.some((line) => line.to === "DONE" && line.reason.includes(ALL_CHILDREN_DONE)))
      continue;
    const started = lines.findIndex((line) => line.to === "IN PROGRESS");
    if (started === -1) continue;
    const ending = lines
      .slice(started + 1)
      .find(
        (line) =>
          line.to === "DONE" ||
          line.to === "BLOCKED" ||
          line.to === "CANCELLED" ||
          (line.to === "IN REVIEW" && line.reason.startsWith("merge-ready")),
      );
    spans.push({
      start: lines[started]?.time.getTime() ?? runEnd,
      end: ending?.time.getTime() ?? runEnd,
    });
  }
  return spans;
}

/**
 * The busy count of each minute from `start` to `end`. The report starts the window at the first
 * build, not at the first line: the lines before it are the selection of the run. Minute `i` starts at `start + i` minutes and ends one
 * minute later. A build is busy in a minute when it covers the start of that minute. A count above
 * the slot limit counts as the limit.
 */
export function slotUseOf(
  spans: readonly BuildSpan[],
  start: number,
  end: number,
): RunReportResponse["slotUse"] {
  const minutes = Math.max(1, Math.ceil((end - start) / MINUTE_MS));
  const perMinute: number[] = [];
  const minutesAtCount = Array.from({ length: RUN_SLOT_LIMIT + 1 }, () => 0);
  let total = 0;
  for (let index = 0; index < minutes; index += 1) {
    const at = start + index * MINUTE_MS;
    const busy = Math.min(
      RUN_SLOT_LIMIT,
      spans.filter((span) => span.start <= at && at < span.end).length,
    );
    perMinute.push(busy);
    minutesAtCount[busy] = (minutesAtCount[busy] ?? 0) + 1;
    total += busy;
  }
  return {
    slotLimit: RUN_SLOT_LIMIT,
    builds: spans.length,
    minutes,
    average: Math.round((total / minutes) * 100) / 100,
    minutesAtCount,
    perMinute,
  };
}

/** The report of one run from its night log lines, its Control events and its summary. */
export function buildRunReport(input: ReportInput): RunReportResponse {
  const { entries } = input;
  const first = entries[0]?.time.getTime() ?? 0;
  const last = entries[entries.length - 1]?.time.getTime() ?? first;
  const spans = buildSpans(entries, last);
  const blockedLines = entries.filter((entry) => entry.to === "BLOCKED" && !isSkip(entry));
  return {
    runId: input.runId,
    start: iso(new Date(first)),
    end: iso(new Date(last)),
    stateChanges: entries
      .filter((entry) => !isSkip(entry))
      .map((entry) => ({
        time: iso(entry.time),
        repo: entry.repo,
        issue: entry.issue,
        from: entry.from,
        to: entry.to,
        reason: entry.reason,
      })),
    merges: mergesOf(entries, input.events),
    blocked: blockedLines.map((entry) => ({
      time: iso(entry.time),
      repo: entry.repo,
      issue: entry.issue,
      reason: entry.reason,
    })),
    skips: skipsOf(entries),
    summary: input.summary,
    slotUse: slotUseOf(
      spans,
      spans.length === 0 ? first : Math.min(...spans.map((span) => span.start)),
      last,
    ),
    skippedLines: input.skippedLines,
  };
}

async function readSummary(
  claudeDir: string,
  runId: string,
): Promise<{ file: string; text: string } | null> {
  const folder = nightLogFolder(claudeDir);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return null;
  }
  const file = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name) && name.endsWith(`-${runId}.md`))
    .sort()
    .at(-1);
  if (file === undefined) return null;
  try {
    const text = (await readFile(path.join(folder, file), "utf8")).slice(0, MAX_SUMMARY_BYTES);
    return { file, text };
  } catch {
    return null;
  }
}

/** Reads the report of one run, or null when the night log of the last 30 days has no line of it. */
export async function readRunReport(
  claudeDir: string,
  runId: string,
  now: Date,
): Promise<RunReportResponse | null> {
  const log = await readJsonlWindow(
    nightLogFolder(claudeDir),
    RunLogLine,
    (line) => parseLineTime(line.time),
    now,
  );
  const entries = log.items
    .filter(({ item }) => item.run_id === runId)
    .map(({ item, time }): ReportEntry => ({
      repo: item.repo,
      issue: item.issue,
      from: item.from,
      to: item.to,
      reason: item.reason,
      time,
      pr: item.pr ?? null,
    }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  if (entries.length === 0) return null;
  const [controls, summary] = await Promise.all([
    readControlEvents(claudeDir, now),
    readSummary(claudeDir, runId),
  ]);
  return buildRunReport({
    runId,
    entries,
    events: controls.events,
    summary,
    skippedLines: log.skippedLines,
  });
}
