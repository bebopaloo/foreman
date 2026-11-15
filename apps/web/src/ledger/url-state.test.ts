import { describe, expect, it } from "vitest";
import { parseLedgerUrl } from "./url-state.ts";

describe("parseLedgerUrl", () => {
  it("has no range with no values", () => {
    expect(parseLedgerUrl("")).toEqual({ range: null, invalid: false });
    expect(parseLedgerUrl("?client=acme")).toEqual({ range: null, invalid: false });
  });

  it("reads a valid range", () => {
    expect(parseLedgerUrl("?from=2026-10-01&to=2026-10-31")).toEqual({
      range: { from: "2026-10-01", to: "2026-10-31" },
      invalid: false,
    });
  });

  it.each([
    ["from after to", "?from=2026-11-20&to=2026-11-01"],
    ["only from", "?from=2026-11-01"],
    ["only to", "?to=2026-11-01"],
    ["not a date", "?from=2026-02-30&to=2026-03-01"],
    ["text", "?from=abc&to=def"],
    ["more than 366 days", "?from=2025-01-01&to=2026-11-01"],
  ])("is not valid with %s", (_name, search) => {
    expect(parseLedgerUrl(search)).toEqual({ range: null, invalid: true });
  });
});
