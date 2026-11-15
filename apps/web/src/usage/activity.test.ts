import type { SeriesResponse } from "@foreman/shared";
import { describe, expect, it } from "vitest";
import { activityLevel } from "../charts/index.ts";
import { calendarStart, daysFrom, monthOutlook, monthStart } from "./activity.ts";

type Bucket = SeriesResponse["buckets"][number];

const bucket = (start: string, turns: number, estimate: number | null): Bucket => ({
  start,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  turns,
  estimate,
  unpricedTurns: 0,
});

describe("the activity calendar range", () => {
  it("starts on the Monday 25 weeks before the Monday of this week", () => {
    expect(calendarStart("2026-11-15")).toBe("2026-05-18");
    expect(calendarStart("2026-11-09")).toBe("2026-05-18");
    expect(calendarStart("2026-11-10")).toBe("2026-05-18");
  });

  it("holds 26 weeks up to the end of the week of a Sunday", () => {
    expect(daysFrom(calendarStart("2026-11-15"), "2026-11-15")).toHaveLength(26 * 7);
  });

  it("ends in the middle of the last week on another day", () => {
    expect(daysFrom(calendarStart("2026-11-11"), "2026-11-11")).toHaveLength(25 * 7 + 3);
  });
});

describe("activity levels", () => {
  it.each([
    [0, 0],
    [1, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
    [75, 3],
    [76, 4],
    [100, 4],
  ])("gives the value %s of 100 the level %s", (value, level) => {
    expect(activityLevel(value, 100)).toBe(level);
  });

  it("gives level 0 when the largest day is 0", () => {
    expect(activityLevel(0, 0)).toBe(0);
  });
});

describe("month outlook", () => {
  it("projects the average per day times the days of the month", () => {
    const outlook = monthOutlook(
      [bucket("2026-11-01", 3, 10), bucket("2026-11-02", 0, 0), bucket("2026-11-14", 5, 20)],
      "2026-11-15",
    );
    expect(outlook).toMatchObject({ soFar: 30, projection: 60, lastDay: "2026-11-30" });
  });

  it("ignores days of an earlier month", () => {
    const outlook = monthOutlook(
      [bucket("2026-10-31", 3, 99), bucket("2026-11-01", 1, 3)],
      "2026-11-03",
    );
    expect(outlook.soFar).toBe(3);
    expect(outlook.projection).toBeCloseTo(30);
  });

  it("has no amount when no turn of the month has a price", () => {
    const outlook = monthOutlook([bucket("2026-11-01", 2, null)], "2026-11-15");
    expect(outlook).toMatchObject({ turns: 2, soFar: null, projection: null });
  });

  it("knows the days of February in a leap year", () => {
    expect(monthOutlook([], "2028-02-10").lastDay).toBe("2028-02-29");
    expect(monthStart("2028-02-10")).toBe("2028-02-01");
  });
});
