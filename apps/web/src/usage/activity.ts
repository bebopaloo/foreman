import type { SeriesResponse } from "@foreman/shared";
import { addDays, type Day } from "./url-state/index.ts";

export const CALENDAR_WEEKS = 26;

/** 0 for Monday to 6 for Sunday. */
function weekdayIndex(day: Day): number {
  const date = new Date(`${day}T00:00:00Z`);
  return (date.getUTCDay() + 6) % 7;
}

/** The Monday 25 weeks before the Monday of the week of `today`. */
export function calendarStart(today: Day): Day {
  const monday = addDays(today, -weekdayIndex(today));
  return addDays(monday, -7 * (CALENDAR_WEEKS - 1));
}

/** The days from `from` to `to`, both included. */
export function daysFrom(from: Day, to: Day): Day[] {
  const days: Day[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function monthStart(today: Day): Day {
  return `${today.slice(0, 8)}01`;
}

type Bucket = SeriesResponse["buckets"][number];

export function bucketsByDay(buckets: readonly Bucket[]): Map<string, Bucket> {
  return new Map(buckets.map((bucket) => [bucket.start, bucket]));
}

export interface MonthOutlookValues {
  turns: number;
  /** The estimate so far this month. Null when no turn of the month has a price. */
  soFar: number | null;
  /** The estimate so far, divided by the days so far, times the days of the month. */
  projection: number | null;
  /** The last day of the month. */
  lastDay: Day;
}

/** The outlook of the month of `today` from the day buckets from the first day of the month. */
export function monthOutlook(buckets: readonly Bucket[], today: Day): MonthOutlookValues {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = monthStart(today);
  const inMonth = buckets.filter((bucket) => bucket.start >= start && bucket.start <= today);
  const turns = inMonth.reduce((sum, bucket) => sum + bucket.turns, 0);
  const priced = inMonth.filter((bucket) => bucket.estimate !== null);
  const soFar = priced.length === 0 ? null : priced.reduce((sum, b) => sum + (b.estimate ?? 0), 0);
  const dayOfMonth = Number(today.slice(8, 10));
  return {
    turns,
    soFar,
    projection: soFar === null ? null : (soFar / dayOfMonth) * daysInMonth,
    lastDay: `${today.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`,
  };
}
