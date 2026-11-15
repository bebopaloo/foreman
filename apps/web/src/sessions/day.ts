const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** The calendar date of a moment in a time zone, as `YYYY-MM-DD`. */
export function dayIn(moment: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(moment)) found[part.type] = part.value;
  return `${found.year ?? ""}-${found.month ?? ""}-${found.day ?? ""}`;
}

/** The day before (-1) or after (+1) a `YYYY-MM-DD` day. */
export function shiftDay(day: string, delta: number): string {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
