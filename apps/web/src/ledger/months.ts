import { dayIn, shiftDay } from "../sessions/day.ts";

export interface DayRange {
  from: string;
  to: string;
}

/** The first day of the month that holds `moment` in the time zone. */
export function monthStart(moment: Date, timeZone: string): string {
  return `${dayIn(moment, timeZone).slice(0, 8)}01`;
}

/** The whole month before the month that holds `moment` in the time zone. */
export function lastMonth(moment: Date, timeZone: string): DayRange {
  const to = shiftDay(monthStart(moment, timeZone), -1);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** The words for a count of minutes in the rule sentence: "1 minute", "15 minutes". */
export function minutesText(count: number): string {
  return `${count.toString()} minute${count === 1 ? "" : "s"}`;
}
