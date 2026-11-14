import { type Database, schema } from "@foreman/db";
import { MAX_SERIES_BUCKETS, type UsageGrain } from "@foreman/shared";
import { sql, type SQL } from "drizzle-orm";
import { labelProjects, projectId } from "./projects.ts";

export interface UsageRange {
  from: string;
  to: string;
  tz: string;
  project?: string | undefined;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  turns: number;
}

const ZERO: TokenCounts = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
};

/** The local date of a turn in the zone of the request. */
function localDate(tz: string): SQL {
  return sql`(${schema.turns.time} at time zone ${tz})`;
}

const sums = {
  inputTokens: sql<number>`coalesce(sum(${schema.turns.inputTokens}), 0)::float8`,
  outputTokens: sql<number>`coalesce(sum(${schema.turns.outputTokens}), 0)::float8`,
  cacheWriteTokens: sql<number>`coalesce(sum(${schema.turns.cacheWrite5mTokens} + ${schema.turns.cacheWrite1hTokens}), 0)::float8`,
  cacheReadTokens: sql<number>`coalesce(sum(${schema.turns.cacheReadTokens}), 0)::float8`,
  turns: sql<number>`count(*)::float8`,
};

function rangeFilter(range: UsageRange, projectKey: string | null): SQL {
  const day = localDate(range.tz);
  const filters: SQL[] = [
    sql`${day}::date >= ${range.from}::date`,
    sql`${day}::date <= ${range.to}::date`,
  ];
  if (projectKey !== null) filters.push(sql`${schema.turns.projectKey} = ${projectKey}`);
  return sql.join(filters, sql` and `);
}

/** The Project key for a Project ID, or null when no Project has this ID. */
export async function findProjectKey(db: Database, id: string): Promise<string | null> {
  const rows = await db.selectDistinct({ key: schema.turns.projectKey }).from(schema.turns);
  return rows.find((row) => projectId(row.key) === id)?.key ?? null;
}

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketStart(date: Date, grain: UsageGrain): Date {
  if (grain === "day") return date;
  if (grain === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - sinceMonday * 86_400_000);
}

function nextBucket(date: Date, grain: UsageGrain): Date {
  if (grain === "day") return new Date(date.getTime() + 86_400_000);
  if (grain === "week") return new Date(date.getTime() + 7 * 86_400_000);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** The start date of each bucket from `from` to `to`, with the bucket that holds `from` first. */
export function bucketStarts(from: string, to: string, grain: UsageGrain): string[] {
  const starts: string[] = [];
  const last = parseDay(to);
  for (
    let current = bucketStart(parseDay(from), grain);
    current <= last;
    current = nextBucket(current, grain)
  ) {
    starts.push(formatDay(current));
    if (starts.length > MAX_SERIES_BUCKETS) break;
  }
  return starts;
}

export async function querySeries(
  db: Database,
  range: UsageRange,
  grain: UsageGrain,
  projectKey: string | null,
) {
  const starts = bucketStarts(range.from, range.to, grain);
  // `grain` is an enum value and `tz` is a parameter. A parameter in the group
  // key would not match the same parameter in the select list, so the key uses
  // a literal zone name that Postgres reads as a string constant.
  const zone = sql.raw(`'${range.tz.replaceAll("'", "''")}'`);
  const start = sql<string>`to_char(date_trunc(${sql.raw(`'${grain}'`)}, ${schema.turns.time} at time zone ${zone}), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ start, ...sums })
    .from(schema.turns)
    .where(rangeFilter(range, projectKey))
    .groupBy(start);
  const byStart = new Map(rows.map((row) => [row.start, row]));
  return starts.map((day) => {
    const row = byStart.get(day);
    return {
      start: day,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      cacheWriteTokens: row?.cacheWriteTokens ?? 0,
      cacheReadTokens: row?.cacheReadTokens ?? 0,
      turns: row?.turns ?? 0,
    };
  });
}

export type BreakdownDimension = "project" | "model" | "agentType" | "branch" | "session";

function dimensionKey(dimension: BreakdownDimension): SQL<string> {
  switch (dimension) {
    case "project":
      return sql<string>`${schema.turns.projectKey}`;
    case "model":
      return sql<string>`${schema.turns.model} || case when ${schema.turns.speed} = 'fast' then ' (fast)' else '' end`;
    case "agentType":
      return sql<string>`${schema.turns.agentType}`;
    case "branch":
      return sql<string>`coalesce(${schema.turns.branch}, '(no branch)')`;
    case "session":
      return sql<string>`${schema.turns.sessionId}`;
  }
}

const total = (row: TokenCounts) =>
  row.inputTokens + row.outputTokens + row.cacheWriteTokens + row.cacheReadTokens;

export async function queryBreakdown(
  db: Database,
  range: UsageRange,
  dimension: BreakdownDimension,
  limit: number,
  projectKey: string | null,
) {
  const key = dimensionKey(dimension);
  const grouped = await db
    .select({
      key,
      projectKey: sql<string>`max(${schema.turns.projectKey})`,
      first: sql<Date>`min(${schema.turns.time})`.mapWith((value: string) => new Date(value)),
      last: sql<Date>`max(${schema.turns.time})`.mapWith((value: string) => new Date(value)),
      ...sums,
    })
    .from(schema.turns)
    .where(rangeFilter(range, projectKey))
    .groupBy(key);

  // Labels come from all Projects, so that a filter does not change a label.
  const refs = await db
    .select({ key: schema.projects.projectKey, noRepo: schema.projects.noRepo })
    .from(schema.projects);
  const labels = labelProjects(refs);
  const labelOf = (projectKey: string) => labels.get(projectKey) ?? projectKey;

  const rows = grouped.map((row) => {
    const counts: TokenCounts = {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      cacheReadTokens: row.cacheReadTokens,
      turns: row.turns,
    };
    if (dimension === "project") {
      return { key: projectId(row.key), label: labelOf(row.key), ...counts };
    }
    if (dimension === "session") {
      return {
        key: row.key,
        label: labelOf(row.projectKey),
        ...counts,
        firstTurnAt: row.first.toISOString(),
        lastTurnAt: row.last.toISOString(),
      };
    }
    return { key: row.key, label: row.key, ...counts };
  });
  rows.sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key));

  const totals = rows.reduce<TokenCounts>(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      cacheWriteTokens: sum.cacheWriteTokens + row.cacheWriteTokens,
      cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
      turns: sum.turns + row.turns,
    }),
    ZERO,
  );
  return { rows: rows.slice(0, limit), totals, rowCount: rows.length };
}
