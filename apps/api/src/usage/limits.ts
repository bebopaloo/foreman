import { type Database, schema } from "@foreman/db";
import type { LimitsQuery, LimitsResponse } from "@foreman/shared";
import { max, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

export const LIMIT_WINDOWS = ["five_hour", "seven_day"] as const;
export type LimitWindow = (typeof LIMIT_WINDOWS)[number];

export interface ParsedLimitReading {
  sessionId: string;
  time: Date;
  window: LimitWindow;
  usedPercentage: number;
  resetsAt: Date;
}

export type ParsedLimitLine =
  { kind: "readings"; readings: ParsedLimitReading[] } | { kind: "ignore" } | { kind: "malformed" };

// The statusline gives the reset time as epoch seconds or as ISO 8601.
const ResetTime = z.union([
  z
    .number()
    .positive()
    .transform((seconds) => new Date(seconds * 1000)),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
]);

const WindowReading = z.object({
  used_percentage: z.number().min(0).max(100),
  resets_at: ResetTime,
});

const CaptureLineSchema = z.object({
  time: z.iso.datetime({ offset: true }),
  session_id: z.string().min(1),
  rate_limits: z
    .object({ five_hour: WindowReading.optional(), seven_day: WindowReading.optional() })
    .nullish(),
});

/**
 * Parses one line of the capture file. A line with no `rate_limits` is not
 * malformed: the statusline has no limits before the first API response.
 */
export function parseLimitLine(line: string): ParsedLimitLine {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
  }
  const parsed = CaptureLineSchema.safeParse(json);
  if (!parsed.success || !Number.isFinite(new Date(parsed.data.time).getTime())) {
    return { kind: "malformed" };
  }
  const { time, session_id: sessionId, rate_limits: limits } = parsed.data;
  if (limits === null || limits === undefined) return { kind: "ignore" };
  const readings = LIMIT_WINDOWS.flatMap((window) => {
    const reading = limits[window];
    return reading === undefined
      ? []
      : [
          {
            sessionId,
            time: new Date(time),
            window,
            usedPercentage: reading.used_percentage,
            resetsAt: reading.resets_at,
          },
        ];
  });
  return readings.length === 0 ? { kind: "ignore" } : { kind: "readings", readings };
}

const epochSeconds = (column: SQLWrapper) =>
  sql<number>`extract(epoch from ${column})::float8`.mapWith(Number);

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/**
 * The peak used percentage of each past Limit window with a reset time in the
 * range, and the latest reading of each window. Readings group by window and by
 * reset time to the minute. A window that has not reset yet is not past.
 */
export async function queryLimits(
  db: Database,
  range: Pick<LimitsQuery, "from" | "to" | "tz">,
): Promise<LimitsResponse> {
  const { limitReadings: readings } = schema;
  const resetMinute = sql`date_trunc('minute', ${readings.resetsAt})`;
  const windows = await db
    .select({
      window: readings.window,
      resetsAt: epochSeconds(resetMinute),
      peak: max(readings.usedPercentage),
    })
    .from(readings)
    .where(
      sql`(${readings.resetsAt} at time zone ${range.tz})::date >= ${range.from}::date
        and (${readings.resetsAt} at time zone ${range.tz})::date <= ${range.to}::date
        and ${readings.resetsAt} <= now()`,
    )
    .groupBy(readings.window, resetMinute)
    .orderBy(resetMinute, readings.window);
  const latest = await db
    .selectDistinctOn([readings.window], {
      window: readings.window,
      time: epochSeconds(readings.time),
      usedPercentage: readings.usedPercentage,
      resetsAt: epochSeconds(readings.resetsAt),
    })
    .from(readings)
    .orderBy(readings.window, sql`${readings.time} desc`);
  const latestOf = (window: LimitWindow) => {
    const row = latest.find((reading) => reading.window === window);
    return row === undefined
      ? null
      : {
          time: iso(row.time),
          usedPercentage: row.usedPercentage,
          resetsAt: iso(row.resetsAt),
        };
  };
  return {
    windows: windows.flatMap((row) =>
      row.peak === null || !isLimitWindow(row.window)
        ? []
        : [{ window: row.window, resetsAt: iso(row.resetsAt), peakUsedPercentage: row.peak }],
    ),
    latest: { five_hour: latestOf("five_hour"), seven_day: latestOf("seven_day") },
  };
}

function isLimitWindow(value: string): value is LimitWindow {
  return LIMIT_WINDOWS.some((window) => window === value);
}
