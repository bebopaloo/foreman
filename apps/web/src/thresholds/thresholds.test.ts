import { describe, expect, it } from "vitest";
import { limitBand, limitWord } from "./index.ts";

describe("limit thresholds", () => {
  it.each([
    [0, "under", "under 70%"],
    [69.9, "under", "under 70%"],
    [70, "warn", "70% or more"],
    [89.9, "warn", "70% or more"],
    [90, "high", "90% or more"],
    [100, "high", "90% or more"],
  ] as const)("puts %s percent in the band %s", (percent, band, word) => {
    expect(limitBand(percent)).toBe(band);
    expect(limitWord(percent)).toBe(word);
  });
});
