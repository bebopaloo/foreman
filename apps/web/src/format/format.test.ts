import { describe, expect, it } from "vitest";
import {
  MISSING,
  browserTimeZone,
  formatDate,
  formatDay,
  formatDuration,
  formatEstimate,
  formatNumber,
  formatRelative,
  formatReset,
  formatTime,
  formatTokens,
} from "./index.ts";

const LONDON = "Europe/London";
const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("compact token numbers", () => {
  it.each([
    [812, "812"],
    [5_340, "5.3K"],
    [850_000, "850K"],
    [999_960, "1M"],
    [1_000_000, "1M"],
    [12_400_000, "12.4M"],
  ])("shows %i as %s", (value, text) => {
    expect(formatTokens(value)).toBe(text);
  });

  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1K"],
    [5_350, "5.4K"],
    [999_949, "999.9K"],
    [999_950, "1M"],
    [1_234_567, "1.2M"],
  ])("shows the edge %i as %s", (value, text) => {
    expect(formatTokens(value)).toBe(text);
  });

  it("writes an uppercase K and M", () => {
    expect(formatTokens(5_340)).not.toMatch(/k/);
    expect(formatTokens(12_400_000)).not.toMatch(/m/);
  });

  it("shows a missing value as a dash", () => {
    expect(formatTokens(null)).toBe(MISSING);
    expect(formatTokens(undefined)).toBe(MISSING);
    expect(formatTokens(Number.NaN)).toBe(MISSING);
  });
});

describe("full numbers", () => {
  it("has thousands separators", () => {
    expect(formatNumber(1_940_000)).toBe("1,940,000");
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(null)).toBe(MISSING);
  });
});

describe("estimates", () => {
  it("shows dollars and cents", () => {
    expect(formatEstimate(1.234)).toBe("$1.23");
    expect(formatEstimate(0)).toBe("$0.00");
  });

  it("shows an amount below one cent as <$0.01", () => {
    expect(formatEstimate(0.004)).toBe("<$0.01");
  });

  it("shows a missing estimate as a dash", () => {
    expect(formatEstimate(null)).toBe("—");
  });
});

describe("durations", () => {
  it("shows whole minutes as hours and minutes", () => {
    expect(formatDuration(2 * 3600 + 40 * 60)).toBe("2 h 40 min");
    expect(formatDuration(0)).toBe("0 h 0 min");
    expect(formatDuration(59 * 60 + 59)).toBe("0 h 59 min");
    expect(formatDuration(3600)).toBe("1 h 0 min");
  });

  it("shows a missing duration as a dash", () => {
    expect(formatDuration(null)).toBe(MISSING);
  });
});

describe("relative times", () => {
  const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 minute ago"],
    [119, "1 minute ago"],
    [120, "2 minutes ago"],
    [3599, "59 minutes ago"],
    [3600, "1 hour ago"],
    [6 * 3600, "6 hours ago"],
    [86_399, "23 hours ago"],
    [86_400, "1 day ago"],
    [3 * 86_400 + 5000, "3 days ago"],
  ])("shows %i seconds ago as %s", (seconds, text) => {
    expect(formatRelative(ago(seconds), NOW)).toBe(text);
  });

  it("shows a time in the future as just now", () => {
    expect(formatRelative(ago(-300), NOW)).toBe("just now");
  });

  it("takes an ISO string and shows a missing or invalid time as a dash", () => {
    expect(formatRelative(ago(7200).toISOString(), NOW)).toBe("2 hours ago");
    expect(formatRelative(null, NOW)).toBe(MISSING);
    expect(formatRelative("not a time", NOW)).toBe(MISSING);
  });
});

describe("times and dates in a time zone", () => {
  it("shows the time on the 24-hour clock", () => {
    expect(formatTime("2026-11-15T09:41:00.000Z", LONDON)).toBe("09:41");
    expect(formatTime("2026-11-15T23:05:00.000Z", "Asia/Tokyo")).toBe("08:05");
    expect(formatTime("2026-11-15T00:00:00.000Z", LONDON)).toBe("00:00");
    expect(formatTime(null, LONDON)).toBe(MISSING);
  });

  it("shows the date as day, short month and year", () => {
    expect(formatDate("2026-11-13T10:00:00.000Z", LONDON)).toBe("13 Nov 2026");
    expect(formatDate("2026-11-13T23:30:00.000Z", "Asia/Tokyo")).toBe("14 Nov 2026");
    expect(formatDate("nope", LONDON)).toBe(MISSING);
  });

  it("shows a ledger day as a date, with no time zone change", () => {
    expect(formatDay("2026-11-13")).toBe("13 Nov 2026");
    expect(formatDay("2026-02-30")).toBe(MISSING);
    expect(formatDay("13/11/2026")).toBe(MISSING);
    expect(formatDay(null)).toBe(MISSING);
  });

  it("names the time zone of the browser", () => {
    expect(browserTimeZone()).toMatch(/^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$/);
  });
});

describe("reset times", () => {
  it("shows only the time when the reset is today", () => {
    expect(formatReset("2026-11-15T13:00:00.000Z", NOW, LONDON)).toBe("13:00");
  });

  it("shows the weekday, date and time on another day", () => {
    expect(formatReset("2026-11-19T09:00:00.000Z", NOW, LONDON)).toBe("Thu 19 Nov, 09:00");
  });

  it("shows a reset in the past on an earlier day with its date", () => {
    expect(formatReset("2026-11-14T09:00:00.000Z", NOW, LONDON)).toBe("Sat 14 Nov, 09:00");
  });

  it("decides today in the given time zone", () => {
    const lateEvening = new Date("2026-11-15T23:30:00.000Z");
    expect(formatReset("2026-11-16T00:30:00.000Z", lateEvening, LONDON)).toBe("Mon 16 Nov, 00:30");
    expect(formatReset("2026-11-16T00:30:00.000Z", lateEvening, "Europe/Paris")).toBe("01:30");
    expect(formatReset(null, NOW, LONDON)).toBe(MISSING);
  });
});
