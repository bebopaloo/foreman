const MINUTE_MS = 60_000;
/** A window shorter than this shows as this long. */
export const MIN_WINDOW_MS = 10 * MINUTE_MS;
const STEPS_MINUTES = [5, 10, 15, 30, 60, 120, 180] as const;
const MAX_TICKS = 8;

export interface Axis {
  startMs: number;
  endMs: number;
  /** Tick times in milliseconds, in order. */
  ticks: number[];
}

/** The offset of a time zone from UTC at a moment, in milliseconds. */
function offsetMs(moment: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(moment))) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  const local = Date.UTC(
    found.year ?? 1970,
    (found.month ?? 1) - 1,
    found.day ?? 1,
    found.hour ?? 0,
    found.minute ?? 0,
  );
  return local - Math.floor(moment / MINUTE_MS) * MINUTE_MS;
}

function ticksFor(startMs: number, endMs: number, stepMs: number, offset: number): number[] {
  const first = Math.ceil((startMs + offset) / stepMs) * stepMs - offset;
  const ticks: number[] = [];
  for (let tick = first; tick <= endMs; tick += stepMs) ticks.push(tick);
  return ticks;
}

/**
 * The time axis of a window. It runs from the start to the end of the window, or 10 minutes from the
 * start for a shorter window. The ticks fall on the clock of the time zone, with the smallest step
 * of 5, 10, 15, 30, 60, 120 or 180 minutes that gives at most 8 ticks.
 */
export function buildAxis(start: string, end: string, timeZone: string): Axis {
  const startMs = Date.parse(start);
  const endMs = Math.max(Date.parse(end), startMs + MIN_WINDOW_MS);
  const offset = offsetMs(startMs, timeZone);
  let ticks: number[] = [];
  for (const step of STEPS_MINUTES) {
    ticks = ticksFor(startMs, endMs, step * MINUTE_MS, offset);
    if (ticks.length <= MAX_TICKS) break;
  }
  return { startMs, endMs, ticks };
}

/** The place of a time on the axis, as a percentage from 0 to 100. */
export function percentOf(axis: Axis, timeMs: number): number {
  const place = ((timeMs - axis.startMs) / (axis.endMs - axis.startMs)) * 100;
  return Math.min(100, Math.max(0, place));
}
