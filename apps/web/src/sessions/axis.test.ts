import { describe, expect, it } from "vitest";
import { buildAxis, percentOf } from "./axis.ts";

describe("buildAxis", () => {
  it("shows a window of less than 10 minutes as 10 minutes from its start", () => {
    const axis = buildAxis("2026-11-14T09:00:00.000Z", "2026-11-14T09:02:00.000Z", "UTC");
    expect(axis.endMs - axis.startMs).toBe(10 * 60_000);
  });

  it("uses the smallest step that gives at most 8 ticks", () => {
    const axis = buildAxis("2026-11-14T09:00:00.000Z", "2026-11-14T09:40:00.000Z", "UTC");
    expect(axis.ticks.map((tick) => new Date(tick).toISOString().slice(11, 16))).toEqual([
      "09:00",
      "09:10",
      "09:20",
      "09:30",
      "09:40",
    ]);
  });

  it("steps to 30 minutes for a window of 3 hours", () => {
    const axis = buildAxis("2026-11-14T09:00:00.000Z", "2026-11-14T12:00:00.000Z", "UTC");
    expect(axis.ticks).toHaveLength(7);
  });

  it("puts the ticks on the clock of the time zone", () => {
    const axis = buildAxis(
      "2026-11-14T09:00:00.000Z",
      "2026-11-14T09:40:00.000Z",
      "Asia/Kathmandu",
    );
    expect(axis.ticks.map((tick) => new Date(tick).toISOString().slice(11, 16))).toEqual([
      "09:05",
      "09:15",
      "09:25",
      "09:35",
    ]);
  });

  it("never gives more than 8 ticks for a whole day", () => {
    const axis = buildAxis("2026-11-14T00:00:00.000Z", "2026-11-14T23:59:00.000Z", "UTC");
    expect(axis.ticks.length).toBeLessThanOrEqual(8);
  });
});

describe("percentOf", () => {
  it("places a time on the axis and clamps it", () => {
    const axis = buildAxis("2026-11-14T09:00:00.000Z", "2026-11-14T09:20:00.000Z", "UTC");
    expect(percentOf(axis, Date.parse("2026-11-14T09:10:00.000Z"))).toBe(50);
    expect(percentOf(axis, Date.parse("2026-11-14T08:00:00.000Z"))).toBe(0);
    expect(percentOf(axis, Date.parse("2026-11-14T10:00:00.000Z"))).toBe(100);
  });
});
