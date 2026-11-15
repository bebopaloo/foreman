/** The text for a missing value. */
export const MISSING = "—";

const fullNumber = new Intl.NumberFormat("en-GB");

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function trimTenths(tenths: number): string {
  const whole = Math.trunc(tenths / 10);
  const fraction = Math.abs(tenths % 10);
  return fraction === 0 ? String(whole) : `${String(whole)}.${String(fraction)}`;
}

/** A full number with thousands separators: "1,940,000". */
export function formatNumber(value: number | null | undefined): string {
  return isNumber(value) ? fullNumber.format(value) : MISSING;
}

/**
 * A compact token count: "812", "5.3K", "850K", "1M", "12.4M".
 * The browser's own compact notation writes `k` and `m`, so this function writes `K` and `M` itself.
 */
export function formatTokens(value: number | null | undefined): string {
  if (!isNumber(value)) return MISSING;
  const sign = value < 0 ? "-" : "";
  const size = Math.abs(value);
  if (size < 1000) return `${sign}${String(Math.round(size))}`;
  // From 999,950 on, one decimal of thousands would round to "1000K".
  if (size < 999_950) return `${sign}${trimTenths(Math.round(size / 100))}K`;
  return `${sign}${trimTenths(Math.round(size / 100_000))}M`;
}

/** An estimate in US dollars: "$1.23", or "<$0.01" for an amount above 0 and below one cent. */
export function formatEstimate(dollars: number | null | undefined): string {
  if (!isNumber(dollars)) return MISSING;
  if (dollars > 0 && dollars < 0.005) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

/** A duration in seconds, as whole minutes: "2 h 40 min", "0 h 0 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isNumber(seconds)) return MISSING;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** The age of a time: "just now", "5 minutes ago", "1 hour ago", "3 days ago". N is rounded down. */
export function formatRelative(time: Date | string | null | undefined, now: Date): string {
  const date = toDate(time);
  if (date === null) return MISSING;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function toDate(time: Date | string | null | undefined): Date | null {
  if (time === null || time === undefined) return null;
  const date = typeof time === "string" ? new Date(time) : time;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The time zone of the browser, for example "Europe/London". */
export function browserTimeZone(): string {
  return new Intl.DateTimeFormat("en-GB").resolvedOptions().timeZone;
}

function parts(date: Date, options: Intl.DateTimeFormatOptions, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    ...options,
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) found[part.type] = part.value;
  return found;
}

const TIME = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const DAY = { year: "numeric", month: "short", day: "numeric" } as const;

function clock(date: Date, timeZone?: string): string {
  const p = parts(date, TIME, timeZone);
  return `${p.hour ?? ""}:${p.minute ?? ""}`;
}

function calendarDay(date: Date, timeZone?: string): string {
  const p = parts(date, DAY, timeZone);
  return `${p.day ?? ""} ${p.month ?? ""} ${p.year ?? ""}`;
}

/** A time on the 24-hour clock, in the browser's time zone: "09:41". */
export function formatTime(time: Date | string | null | undefined, timeZone?: string): string {
  const date = toDate(time);
  return date === null ? MISSING : clock(date, timeZone);
}

/** A date in the browser's time zone: "13 Nov 2026". */
export function formatDate(time: Date | string | null | undefined, timeZone?: string): string {
  const date = toDate(time);
  return date === null ? MISSING : calendarDay(date, timeZone);
}

/** A `YYYY-MM-DD` day as a date, with no time zone change: "13 Nov 2026". */
export function formatDay(day: string | null | undefined): string {
  if (day === null || day === undefined) return MISSING;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return MISSING;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return MISSING;
  return calendarDay(date, "UTC");
}

/**
 * The reset time of a Limit window: the time when it is on today ("13:00"), else the weekday,
 * the date and the time ("Thu 19 Nov, 09:00"). Today is the day of `now` in the same time zone.
 */
export function formatReset(
  time: Date | string | null | undefined,
  now: Date,
  timeZone?: string,
): string {
  const date = toDate(time);
  if (date === null) return MISSING;
  if (calendarDay(date, timeZone) === calendarDay(now, timeZone)) return clock(date, timeZone);
  const p = parts(date, { weekday: "short", day: "numeric", month: "short" }, timeZone);
  return `${p.weekday ?? ""} ${p.day ?? ""} ${p.month ?? ""}, ${clock(date, timeZone)}`;
}
