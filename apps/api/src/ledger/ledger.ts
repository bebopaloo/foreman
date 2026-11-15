import { type Database, schema } from "@foreman/db";
import {
  MAX_LEDGER_REPOS,
  type LedgerRepo,
  type LedgerResponse,
  type LedgerRow,
} from "@foreman/shared";
import { and, gte, lt, sql } from "drizzle-orm";
import { type CursorKey, paginate } from "../paging.ts";
import { labelProjects, projectId, type ProjectRef } from "../usage/projects.ts";
import type { RepoEntry } from "../work/repo-list.ts";
import {
  interactiveTime,
  ledgerDay,
  roundSecondsToMinutes,
  type InteractiveTimeRules,
} from "./interactive-time.ts";

export interface LedgerInput {
  rules: InteractiveTimeRules;
  repos: readonly RepoEntry[];
  from: string;
  to: string;
  /** The Project keys of the client scope, or null for "All". */
  scopeKeys: readonly string[] | null;
  /** The client of the scope, for the cursor. */
  client: string | undefined;
  limit: number;
  cursor: string | undefined;
}

const DAY_MS = 86_400_000;

/** The first day of the month of a `YYYY-MM-DD` day. */
export function firstOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

interface Cell {
  day: string;
  projectKey: string;
  seconds: number;
  messages: number;
  sessions: Set<string>;
  tokens: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The sort key of a row: the day from new to old, then the label, then the Project ID. */
function rowKey(row: LedgerRow): CursorKey {
  return [row.day, row.label, row.projectId];
}

function compareRowKeys(a: CursorKey, b: CursorKey): number {
  return (
    compareText(String(b[0]), String(a[0])) ||
    compareText(String(a[1]), String(b[1])) ||
    compareText(String(a[2]), String(b[2]))
  );
}

function compareLines(a: LedgerRepo, b: LedgerRepo): number {
  // "Unassigned" (no client) comes last.
  if ((a.client === null) !== (b.client === null)) return a.client === null ? 1 : -1;
  return (
    compareText(a.client ?? "", b.client ?? "") ||
    compareText(a.label, b.label) ||
    compareText(a.projectId, b.projectId)
  );
}

/**
 * One ledger response. The timeline holds all messages of the index, so the client scope
 * never changes the time of a row. Nothing is stored: the ledger is computed on read.
 */
export async function queryLedger(db: Database, input: LedgerInput): Promise<LedgerResponse> {
  const { rules, from, to } = input;
  // Wider than any time zone offset plus the longest idle cut-off. The day of each record
  // is checked below, in the ledger time zone.
  const lower = new Date(Date.parse(`${from}T00:00:00.000Z`) - 2 * DAY_MS);
  const upper = new Date(Date.parse(`${to}T00:00:00.000Z`) + 3 * DAY_MS);

  const messageRows = await db
    .select({
      id: schema.userMessages.recordId,
      sessionId: schema.userMessages.sessionId,
      time: schema.userMessages.time,
      projectKey: schema.userMessages.projectKey,
    })
    .from(schema.userMessages)
    .where(and(gte(schema.userMessages.time, lower), lt(schema.userMessages.time, upper)));

  const day = sql<string>`to_char(${schema.turns.time} at time zone ${rules.timeZone}, 'YYYY-MM-DD')`;
  const turnRows = await db
    .select({
      day,
      projectKey: schema.turns.projectKey,
      tokens: sql<number>`coalesce(sum(${schema.turns.inputTokens} + ${schema.turns.outputTokens} + ${schema.turns.cacheWrite5mTokens} + ${schema.turns.cacheWrite1hTokens} + ${schema.turns.cacheReadTokens}), 0)::float8`,
    })
    .from(schema.turns)
    .where(and(gte(schema.turns.time, lower), lt(schema.turns.time, upper)))
    .groupBy(sql`1`, schema.turns.projectKey);

  const noRepoRows = await db
    .select({ key: schema.projects.projectKey, noRepo: schema.projects.noRepo })
    .from(schema.projects);

  const sessionById = new Map(messageRows.map((message) => [message.id, message.sessionId]));
  const entries = interactiveTime(
    messageRows.map((message) => ({
      id: message.id,
      time: message.time,
      projectKey: message.projectKey,
    })),
    rules,
  );

  const inScope = (projectKey: string): boolean =>
    input.scopeKeys === null || input.scopeKeys.includes(projectKey);
  const cells = new Map<string, Cell>();
  const cellOf = (cellDay: string, projectKey: string): Cell => {
    const id = `${cellDay}\u0000${projectKey}`;
    let cell = cells.get(id);
    if (cell === undefined) {
      cell = { day: cellDay, projectKey, seconds: 0, messages: 0, sessions: new Set(), tokens: 0 };
      cells.set(id, cell);
    }
    return cell;
  };
  for (const entry of entries) {
    if (entry.day < from || entry.day > to || !inScope(entry.projectKey)) continue;
    const cell = cellOf(entry.day, entry.projectKey);
    cell.seconds += entry.seconds;
    cell.messages += 1;
    const sessionId = sessionById.get(entry.id);
    if (sessionId !== undefined) cell.sessions.add(sessionId);
  }
  for (const turn of turnRows) {
    if (turn.day < from || turn.day > to || !inScope(turn.projectKey)) continue;
    cellOf(turn.day, turn.projectKey).tokens += turn.tokens;
  }

  const entryByPath = new Map<string, RepoEntry>();
  for (const repo of input.repos) {
    if (!entryByPath.has(repo.path)) entryByPath.set(repo.path, repo);
  }
  const projectKeys = new Set<string>([...cells.values()].map((cell) => cell.projectKey));
  const refs: ProjectRef[] = [];
  const noRepoByKey = new Map(noRepoRows.map((row) => [row.key, row.noRepo]));
  for (const key of new Set([...noRepoByKey.keys(), ...projectKeys])) {
    refs.push({ key, noRepo: noRepoByKey.get(key) ?? false });
  }
  const labels = labelProjects(refs);

  const describe = (projectKey: string) => {
    const entry = entryByPath.get(projectKey);
    const owner = entry?.owner ?? null;
    const name = entry?.name ?? null;
    const label =
      owner !== null && name !== null ? `${owner}/${name}` : (labels.get(projectKey) ?? projectKey);
    return {
      projectId: projectId(projectKey),
      repoId: entry?.id ?? null,
      label,
      client: entry?.client ?? null,
    };
  };

  const rows: LedgerRow[] = [...cells.values()].map((cell) => ({
    day: cell.day,
    ...describe(cell.projectKey),
    interactiveMinutes: roundSecondsToMinutes(cell.seconds),
    messages: cell.messages,
    sessions: cell.sessions.size,
    tokens: cell.tokens,
  }));
  rows.sort((a, b) => compareRowKeys(rowKey(a), rowKey(b)));

  const lineByProject = new Map<string, { line: LedgerRepo; sessions: Set<string> }>();
  const allSessions = new Set<string>();
  const totals = { interactiveMinutes: 0, messages: 0, sessions: 0, tokens: 0 };
  for (const cell of cells.values()) {
    const minutes = roundSecondsToMinutes(cell.seconds);
    let item = lineByProject.get(cell.projectKey);
    if (item === undefined) {
      item = {
        line: {
          ...describe(cell.projectKey),
          interactiveMinutes: 0,
          days: 0,
          sessions: 0,
          tokens: 0,
        },
        sessions: new Set(),
      };
      lineByProject.set(cell.projectKey, item);
    }
    item.line.interactiveMinutes += minutes;
    if (minutes > 0) item.line.days += 1;
    item.line.tokens += cell.tokens;
    for (const session of cell.sessions) {
      item.sessions.add(session);
      allSessions.add(session);
    }
    totals.interactiveMinutes += minutes;
    totals.messages += cell.messages;
    totals.tokens += cell.tokens;
  }
  totals.sessions = allSessions.size;
  const lines = [...lineByProject.values()]
    .map(({ line, sessions }) => ({ ...line, sessions: sessions.size }))
    .sort(compareLines);

  const page = paginate(rows, {
    limit: input.limit,
    cursor: input.cursor,
    query: { from, to, client: input.client },
    keyOf: rowKey,
    compare: compareRowKeys,
  });

  return {
    rules: {
      timeZone: rules.timeZone,
      idleMinutes: rules.idleMinutes,
      leadInMinutes: rules.leadInMinutes,
    },
    range: { from, to },
    rows: page.items,
    rowCount: rows.length,
    nextCursor: page.nextCursor,
    repos: {
      lines: lines.slice(0, MAX_LEDGER_REPOS),
      cut: Math.max(0, lines.length - MAX_LEDGER_REPOS),
    },
    totals,
  };
}

/** Today in the ledger time zone, as `YYYY-MM-DD`. */
export function ledgerToday(now: Date, timeZone: string): string {
  return ledgerDay(now, timeZone);
}
