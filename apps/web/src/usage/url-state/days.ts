/** A calendar day as `YYYY-MM-DD`. The helpers do no time zone change: they work on the day itself. */
export type Day = string;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function utc(day: Day): Date | null {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date;
}

export function isDay(value: string): boolean {
  return utc(value) !== null;
}

const pad = (value: number): string => String(value).padStart(2, "0");

function write(date: Date): Day {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The day of a moment in the time zone of the browser. */
export function localDay(moment: Date): Day {
  return `${String(moment.getFullYear()).padStart(4, "0")}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

export function addDays(day: Day, count: number): Day {
  const date = utc(day);
  if (date === null) throw new Error(`Not a day: ${day}`);
  return write(new Date(date.getTime() + count * DAY_MS));
}

/** The same date `count` months earlier, or the last day of that month when it has no such date. */
export function subtractMonths(day: Day, count: number): Day {
  const date = utc(day);
  if (date === null) throw new Error(`Not a day: ${day}`);
  const index = date.getUTCFullYear() * 12 + date.getUTCMonth() - count;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return write(new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))));
}

export function daysBetween(from: Day, to: Day): number {
  const a = utc(from);
  const b = utc(to);
  if (a === null || b === null) throw new Error("Not a day");
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
