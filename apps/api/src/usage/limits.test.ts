import { describe, expect, it } from "vitest";
import { parseLimitLine } from "./limits.ts";

const line = (value: unknown) => JSON.stringify(value);

describe("parseLimitLine", () => {
  it("reads both windows, with the reset time as epoch seconds or as ISO 8601", () => {
    const result = parseLimitLine(
      line({
        time: "2026-11-01T10:00:00.000Z",
        session_id: "s1",
        rate_limits: {
          five_hour: { used_percentage: 12.5, resets_at: 1_793_000_000 },
          seven_day: { used_percentage: 40, resets_at: "2026-11-05T09:00:00Z" },
        },
      }),
    );

    expect(result).toEqual({
      kind: "readings",
      readings: [
        {
          sessionId: "s1",
          time: new Date("2026-11-01T10:00:00.000Z"),
          window: "five_hour",
          usedPercentage: 12.5,
          resetsAt: new Date(1_793_000_000_000),
        },
        {
          sessionId: "s1",
          time: new Date("2026-11-01T10:00:00.000Z"),
          window: "seven_day",
          usedPercentage: 40,
          resetsAt: new Date("2026-11-05T09:00:00Z"),
        },
      ],
    });
  });

  it("ignores a line with no rate limits, and does not call it malformed", () => {
    const base = { time: "2026-11-01T10:00:00.000Z", session_id: "s1" };
    expect(parseLimitLine(line(base)).kind).toBe("ignore");
    expect(parseLimitLine(line({ ...base, rate_limits: null })).kind).toBe("ignore");
    expect(parseLimitLine(line({ ...base, rate_limits: {} })).kind).toBe("ignore");
  });

  it("calls a line malformed when it is not JSON or has a wrong field", () => {
    const base = { time: "2026-11-01T10:00:00.000Z", session_id: "s1" };
    expect(parseLimitLine("{not json").kind).toBe("malformed");
    expect(parseLimitLine(line({ ...base, time: "yesterday" })).kind).toBe("malformed");
    expect(
      parseLimitLine(
        line({ ...base, rate_limits: { five_hour: { used_percentage: 120, resets_at: 1 } } }),
      ).kind,
    ).toBe("malformed");
  });
});
