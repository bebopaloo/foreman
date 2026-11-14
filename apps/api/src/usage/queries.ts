import { type Database, schema } from "@foreman/db";
import { ESTIMATE_NOTE, MAX_SERIES_BUCKETS, type UsageGrain } from "@foreman/shared";
import { sql, type SQL } from "drizzle-orm";
import { estimateGroup, type PriceTable } from "./prices.ts";
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

// The estimate needs the model, the speed and the service tier of each turn, so each query
// groups by them as well. The rows merge in code, after the price of each group is known.
const priceSums = {
  model: schema.turns.model,
  speed: schema.turns.speed,
  serviceTier: schema.turns.serviceTier,
  cacheWrite5mTokens: sql<number>`coalesce(sum(${schema.turns.cacheWrite5mTokens}), 0)::float8`,
  cacheWrite1hTokens: sql<number>`coalesce(sum(${schema.turns.cacheWrite1hTokens}), 0)::float8`,
  webSearchCount: sql<number>`coalesce(sum(${schema.turns.webSearchCount}), 0)::float8`,
};

const priceGroupBy = [schema.turns.model, schema.turns.speed, schema.turns.serviceTier] as const;

interface PricedGroup extends TokenCounts {
  model: string;
  speed: string | null;
  serviceTier: string | null;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearchCount: number;
}

/** The totals of the groups that fall into one row, bucket or response. */
class Accumulator {
  counts: TokenCounts = { ...ZERO };
  estimate = 0;
  unpricedTurns = 0;

  add(table: PriceTable, group: PricedGroup, unpriced: Map<string, number>): void {
    this.counts = {
      inputTokens: this.counts.inputTokens + group.inputTokens,
      outputTokens: this.counts.outputTokens + group.outputTokens,
      cacheWriteTokens: this.counts.cacheWriteTokens + group.cacheWriteTokens,
      cacheReadTokens: this.counts.cacheReadTokens + group.cacheReadTokens,
      turns: this.counts.turns + group.turns,
    };
    const result = estimateGroup(table, group);
    this.estimate += result.estimate;
    this.unpricedTurns += result.unpricedTurns;
    if (result.unpricedModel !== null) {
      unpriced.set(result.unpricedModel, (unpriced.get(result.unpricedModel) ?? 0) + group.turns);
    }
  }

  /** Token counts and estimate. The estimate is null when all turns are unpriced. */
  result() {
    const allUnpriced = this.counts.turns > 0 && this.unpricedTurns === this.counts.turns;
    return {
      ...this.counts,
      estimate: allUnpriced ? null : Math.round(this.estimate * 1e6) / 1e6,
      unpricedTurns: this.unpricedTurns,
    };
  }
}

function unpricedList(unpriced: Map<string, number>) {
  return [...unpriced]
    .map(([model, turns]) => ({ model, turns }))
    .sort((a, b) => b.turns - a.turns || a.model.localeCompare(b.model));
}

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
  table: PriceTable,
  range: UsageRange,
  grain: UsageGrain,
  projectKey: string | null,
) {
  const starts = bucketStarts(range.from, range.to, grain);
  const start = sql<string>`to_char(date_trunc(${grain}::text, ${schema.turns.time} at time zone ${range.tz}::text), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ start, ...sums, ...priceSums })
    .from(schema.turns)
    .where(rangeFilter(range, projectKey))
    .groupBy(sql`1`, ...priceGroupBy);
  const unpriced = new Map<string, number>();
  const byStart = new Map<string, Accumulator>();
  for (const row of rows) {
    const bucket = byStart.get(row.start) ?? new Accumulator();
    bucket.add(table, row, unpriced);
    byStart.set(row.start, bucket);
  }
  return {
    buckets: starts.map((day) => ({
      start: day,
      ...(byStart.get(day) ?? new Accumulator()).result(),
    })),
    unpricedModels: unpricedList(unpriced),
    note: ESTIMATE_NOTE,
  };
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

interface DimensionGroup {
  accumulator: Accumulator;
  projectKey: string;
  first: Date;
  last: Date;
}

export async function queryBreakdown(
  db: Database,
  table: PriceTable,
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
      ...priceSums,
    })
    .from(schema.turns)
    .where(rangeFilter(range, projectKey))
    .groupBy(key, ...priceGroupBy);

  // Labels come from all Projects, so that a filter does not change a label.
  const refs = await db
    .select({ key: schema.projects.projectKey, noRepo: schema.projects.noRepo })
    .from(schema.projects);
  const labels = labelProjects(refs);
  const labelOf = (projectKey: string) => labels.get(projectKey) ?? projectKey;

  const unpriced = new Map<string, number>();
  const everything = new Accumulator();
  const byKey = new Map<string, DimensionGroup>();
  for (const row of grouped) {
    const existing = byKey.get(row.key);
    const group = existing ?? {
      accumulator: new Accumulator(),
      projectKey: row.projectKey,
      first: row.first,
      last: row.last,
    };
    group.accumulator.add(table, row, unpriced);
    // The totals row counts each group once, so the unpriced models are not counted twice.
    everything.add(table, row, new Map());
    if (row.first < group.first) group.first = row.first;
    if (row.last > group.last) group.last = row.last;
    byKey.set(row.key, group);
  }

  const rows = [...byKey].map(([groupKey, group]) => {
    const figures = group.accumulator.result();
    if (dimension === "project") {
      return { key: projectId(groupKey), label: labelOf(groupKey), ...figures };
    }
    if (dimension === "session") {
      return {
        key: groupKey,
        label: labelOf(group.projectKey),
        ...figures,
        firstTurnAt: group.first.toISOString(),
        lastTurnAt: group.last.toISOString(),
      };
    }
    return { key: groupKey, label: groupKey, ...figures };
  });
  rows.sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key));

  return {
    rows: rows.slice(0, limit),
    totals: everything.result(),
    rowCount: rows.length,
    unpricedModels: unpricedList(unpriced),
    note: ESTIMATE_NOTE,
  };
}
