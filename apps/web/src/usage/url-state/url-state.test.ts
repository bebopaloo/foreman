import { describe, expect, it } from "vitest";
import { effectiveGrain, parseUsageUrl, resolveRange, writeUsageUrl } from "./url-state.ts";

describe("parseUsageUrl", () => {
  it("gives the defaults for a URL with no value", () => {
    const { state, invalid } = parseUsageUrl("");
    expect(invalid).toBe(false);
    expect(state).toEqual({
      range: { kind: "relative", count: 14, unit: "d" },
      grain: "day",
      metric: "tokens",
      tab: "project",
    });
  });

  it("reads each valid value", () => {
    const { state, invalid } = parseUsageUrl("?range=3m&grain=week&metric=estimate&tab=model");
    expect(invalid).toBe(false);
    expect(state).toEqual({
      range: { kind: "relative", count: 3, unit: "m" },
      grain: "week",
      metric: "estimate",
      tab: "model",
    });
  });

  it("replaces each invalid value with its default", () => {
    const { state, invalid } = parseUsageUrl("?range=0d&grain=hour&metric=cost&tab=nope");
    expect(invalid).toBe(true);
    expect(state).toEqual(parseUsageUrl("").state);
  });

  it.each(["366d", "5y", "d", "-3d", "1.5d", ""])("rejects the range %j", (range) => {
    expect(parseUsageUrl(`?range=${range}`).invalid).toBe(true);
  });

  it("rejects dates in the wrong order, one date alone and a date that does not exist", () => {
    for (const search of [
      "?from=2026-11-20&to=2026-11-01",
      "?from=2026-11-01",
      "?to=2026-11-01",
      "?from=2026-02-30&to=2026-03-01",
    ]) {
      const parsed = parseUsageUrl(search);
      expect(parsed.invalid).toBe(true);
      expect(parsed.state.range).toEqual({ kind: "relative", count: 14, unit: "d" });
    }
  });

  it("ignores the range when it has two valid dates", () => {
    const { state, invalid } = parseUsageUrl("?range=7d&from=2026-10-01&to=2026-10-31");
    expect(invalid).toBe(false);
    expect(state.range).toEqual({ kind: "absolute", from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("writeUsageUrl", () => {
  it("writes the values and keeps the Client scope", () => {
    const search = writeUsageUrl("?client=acme", parseUsageUrl("").state);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      client: "acme",
      range: "14d",
      grain: "day",
      metric: "tokens",
      tab: "project",
    });
  });

  it("writes an absolute range with no `range`", () => {
    const state = parseUsageUrl("?range=7d").state;
    const search = writeUsageUrl("?range=7d", {
      ...state,
      range: { kind: "absolute", from: "2026-10-01", to: "2026-10-31" },
    });
    const params = new URLSearchParams(search);
    expect(params.get("from")).toBe("2026-10-01");
    expect(params.get("to")).toBe("2026-10-31");
    expect(params.has("range")).toBe(false);
  });
});

describe("resolveRange", () => {
  const today = "2026-11-15";
  it("counts days that end today", () => {
    expect(resolveRange({ kind: "relative", count: 14, unit: "d" }, today)).toEqual({
      from: "2026-11-02",
      to: today,
    });
  });
  it("counts weeks as 7 days each", () => {
    expect(resolveRange({ kind: "relative", count: 2, unit: "w" }, today).from).toBe("2026-11-02");
  });
  it("starts a month range on the day after the same date N months before", () => {
    expect(resolveRange({ kind: "relative", count: 1, unit: "m" }, today).from).toBe("2026-10-16");
    expect(resolveRange({ kind: "relative", count: 3, unit: "m" }, "2026-05-31").from).toBe(
      "2026-03-01",
    );
  });
});

describe("effectiveGrain", () => {
  it("uses months when the range needs too many buckets for its grain", () => {
    const range = { from: "2000-01-01", to: "2026-11-15" };
    expect(effectiveGrain(range, "day")).toEqual({ grain: "month", tooLong: true });
    expect(effectiveGrain(range, "week")).toEqual({ grain: "week", tooLong: false });
    expect(effectiveGrain({ from: "2026-11-02", to: "2026-11-15" }, "day").tooLong).toBe(false);
  });
});
