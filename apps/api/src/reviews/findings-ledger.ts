import path from "node:path";
import {
  FindingOutcome,
  FindingSeverity,
  FindingStatus,
  SECURITY_PASS,
  type FindingsQuery,
  type FindingsResponse,
  type RollupColumn,
} from "@foreman/shared";
import { z } from "zod";
import { LINE_TIME } from "../dash/night-log.ts";
import { parseLineTime, readJsonlWindow, type WindowRead } from "../dash/jsonl-window.ts";
import type { CursorKey } from "../paging.ts";

/** A line of the findings ledger. Fields that the factory adds later are ignored, not refused. */
const LedgerLine = z.object({
  time: z.string().regex(LINE_TIME),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  pr: z.number().int().positive(),
  issue: z.number().int().positive().nullish(),
  round: z.number().int().min(1),
  fingerprint: z.string().min(1).max(100),
  pass: z.string().min(1).max(60),
  category: z.string().max(100),
  severity: FindingSeverity,
  file: z.string().max(1000).nullish(),
  line: z.number().int().nullish(),
  status: FindingStatus,
  outcome: FindingOutcome.nullish(),
  thread: z.string().max(2000).nullish(),
});

/** One valid line, in the order of the files. */
export interface LedgerFinding {
  line: z.output<typeof LedgerLine>;
  at: Date;
}

export interface FindingsLedgerRead extends Omit<WindowRead<unknown>, "items"> {
  findings: LedgerFinding[];
}

export function findingsFolder(claudeDir: string): string {
  return path.join(claudeDir, "factory", "findings");
}

/** The valid lines of the last 30 days, oldest file first. A line that is not valid is skipped and counted. */
export async function readFindingsLedger(
  claudeDir: string,
  now: Date,
): Promise<FindingsLedgerRead> {
  const { items, ...rest } = await readJsonlWindow(
    findingsFolder(claudeDir),
    LedgerLine,
    (line) => parseLineTime(line.time),
    now,
  );
  return { ...rest, findings: items.map(({ item, time }) => ({ line: item, at: time })) };
}

/** A finding row before the route adds the link. */
export type FindingRow = Omit<FindingsResponse["items"][number], "link">;

export interface FindingsFilter {
  repoNames: ReadonlySet<string> | null;
  filter: Pick<FindingsQuery, "repo" | "pass" | "severity" | "status" | "outcome">;
}

export interface BuiltFindings {
  /** The rows after the filters, newest first. */
  rows: FindingRow[];
  security: FindingsResponse["security"];
  repos: string[];
  passes: string[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function emptyRollup(): FindingsResponse["security"]["bySeverity"] {
  const row = () => ({
    open: 0,
    fixed: 0,
    refuted: 0,
    deferred: 0,
    waived: 0,
    disagreed: 0,
    total: 0,
  });
  return { blocker: row(), major: row(), minor: row(), info: row() };
}

/** A refuted finding is refuted. A verified finding with no outcome is open. A dropped finding has no column. */
export function rollupColumn(row: Pick<FindingRow, "status" | "outcome">): RollupColumn | null {
  if (row.status === "dropped") return null;
  if (row.status === "refuted") return "refuted";
  return row.outcome ?? "open";
}

/**
 * One row for each repo, pull request and fingerprint. The latest line by time gives the values; of
 * two lines with the same time, the later one in the files wins. The round is the first one seen.
 */
export function latestFindings(findings: readonly LedgerFinding[]): FindingRow[] {
  const found = new Map<string, { row: FindingRow; at: number }>();
  for (const { line, at } of findings) {
    const key = `${line.repo.toLowerCase()}\u0000${line.pr.toString()}\u0000${line.fingerprint}`;
    const before = found.get(key);
    const row: FindingRow = {
      fingerprint: line.fingerprint,
      repo: line.repo,
      pr: line.pr,
      issue: line.issue ?? null,
      round: before === undefined ? line.round : Math.min(before.row.round, line.round),
      pass: line.pass,
      category: line.category,
      severity: line.severity,
      status: line.status,
      outcome: line.outcome ?? null,
      file: line.file ?? null,
      line: line.line ?? null,
      thread: line.thread ?? null,
      time: line.time,
    };
    if (before === undefined || at.getTime() >= before.at) {
      found.set(key, { row, at: at.getTime() });
    } else {
      // An older line that arrives late can still hold the first round.
      before.row.round = row.round;
    }
  }
  return [...found.values()].map(({ row }) => row);
}

export const findingKey = (row: FindingRow): CursorKey => [
  row.time,
  row.repo.toLowerCase(),
  row.pr,
  row.fingerprint,
];

/** The newest first, then repo, pull request number and fingerprint. */
export const compareFindingKeys = (a: CursorKey, b: CursorKey): number =>
  byText(String(b[0]), String(a[0])) ||
  byText(String(a[1]), String(b[1])) ||
  Number(a[2]) - Number(b[2]) ||
  byText(String(a[3]), String(b[3]));

export function buildFindings(
  findings: readonly LedgerFinding[],
  { repoNames, filter }: FindingsFilter,
): BuiltFindings {
  const inScope = latestFindings(findings).filter(
    (row) => repoNames === null || repoNames.has(row.repo.toLowerCase()),
  );
  const security = emptyRollup();
  const repo = filter.repo?.toLowerCase();
  for (const row of inScope) {
    if (row.pass !== SECURITY_PASS || (repo !== undefined && row.repo.toLowerCase() !== repo)) {
      continue;
    }
    const column = rollupColumn(row);
    if (column === null) continue;
    security[row.severity][column] += 1;
    security[row.severity].total += 1;
  }
  const rows = inScope
    .filter(
      (row) =>
        (repo === undefined || row.repo.toLowerCase() === repo) &&
        (filter.pass === undefined || row.pass === filter.pass) &&
        (filter.severity === undefined || row.severity === filter.severity) &&
        (filter.status === undefined || row.status === filter.status) &&
        (filter.outcome === undefined ||
          (filter.outcome === "none" ? row.outcome === null : row.outcome === filter.outcome)),
    )
    .sort((a, b) => compareFindingKeys(findingKey(a), findingKey(b)));
  const distinct = (values: string[]) => [...new Set(values)].sort(byText);
  return {
    rows,
    security: { bySeverity: security },
    repos: distinct(inScope.map((row) => row.repo)),
    passes: distinct(inScope.map((row) => row.pass)),
  };
}
