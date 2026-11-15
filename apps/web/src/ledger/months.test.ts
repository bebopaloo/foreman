import { describe, expect, it } from "vitest";
import { lastMonth, minutesText, monthStart } from "./months.ts";

describe("months", () => {
  it("finds the first day of the month in the ledger time zone", () => {
    expect(monthStart(new Date("2026-11-15T12:00:00Z"), "Europe/London")).toBe("2026-11-01");
    // 00:30 on 1 Jul in British Summer Time is still 30 Jun in UTC.
    expect(monthStart(new Date("2026-06-30T23:30:00Z"), "Europe/London")).toBe("2026-07-01");
    expect(monthStart(new Date("2026-06-30T23:30:00Z"), "UTC")).toBe("2026-06-01");
  });

  it("finds the whole month before", () => {
    expect(lastMonth(new Date("2026-11-15T12:00:00Z"), "Europe/London")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(lastMonth(new Date("2026-01-03T12:00:00Z"), "UTC")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(lastMonth(new Date("2026-03-10T12:00:00Z"), "UTC")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("writes minutes in the singular and the plural", () => {
    expect(minutesText(1)).toBe("1 minute");
    expect(minutesText(15)).toBe("15 minutes");
  });
});
