import { describe, expect, it } from "vitest";
import { dayIn, isCalendarDay, shiftDay } from "./day.ts";

describe("isCalendarDay", () => {
  it.each(["2026-11-14", "2028-02-29"])("accepts %s", (value) => {
    expect(isCalendarDay(value)).toBe(true);
  });

  it.each(["2026-02-30", "2026-13-01", "14-11-2026", "tomorrow", ""])("rejects %s", (value) => {
    expect(isCalendarDay(value)).toBe(false);
  });
});

describe("dayIn", () => {
  it("gives the date in the time zone, not in UTC", () => {
    const moment = new Date("2026-11-14T23:30:00.000Z");
    expect(dayIn(moment, "UTC")).toBe("2026-11-14");
    expect(dayIn(moment, "Europe/Berlin")).toBe("2026-11-15");
  });
});

describe("shiftDay", () => {
  it("moves over month and year ends", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});
