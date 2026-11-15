import { describe, expect, it } from "vitest";
import { pullRequestRecords } from "./pr-records.ts";
import { escalated, gate, merged } from "../../test/control-event-fixtures.ts";
import {
  mergesByBaseAndTier,
  pathAgainstFinalTier,
  pullRequestsByFinalTier,
} from "./tier-results.ts";

const cellOf = (
  result: ReturnType<typeof pathAgainstFinalTier>,
  pathTier: string,
  finalTier: string,
) => result.cells.find((cell) => cell.pathTier === pathTier && cell.finalTier === finalTier);

describe("tier results", () => {
  it("shows zero counts and no cell for no gate decision", () => {
    const records = pullRequestRecords([]);
    expect(pullRequestsByFinalTier(records)).toEqual({
      authority: 0,
      sensitive: 0,
      general: 0,
      inert: 0,
      none: 0,
    });
    const table = pathAgainstFinalTier(records);
    expect(table.noTier).toBe(0);
    expect(table.cells.every((cell) => cell.count === 0)).toBe(true);
  });

  it("counts an escalated pull request once, as its final tier, off the diagonal", () => {
    const records = pullRequestRecords([
      gate({ pr: 40, tier: "general", decision: "fail" }),
      escalated({ pr: 40, path_tier: "general", tier: "authority" }),
      gate({ pr: 40, tier: "authority", round: 2 }),
    ]);
    expect(pullRequestsByFinalTier(records)).toMatchObject({ authority: 1, general: 0 });
    expect(cellOf(pathAgainstFinalTier(records), "general", "authority")).toEqual({
      pathTier: "general",
      finalTier: "authority",
      count: 1,
      escalated: true,
    });
  });

  it("counts a pull request with no escalation on the diagonal", () => {
    const records = pullRequestRecords([gate({ pr: 41, tier: "sensitive" })]);
    const cell = cellOf(pathAgainstFinalTier(records), "sensitive", "sensitive");
    expect(cell).toMatchObject({ count: 1, escalated: false });
  });

  it("counts a pull request with no tier as none and leaves it out of the table", () => {
    const records = pullRequestRecords([gate({ pr: 1 }), gate({ pr: 2, decision: "fail" })]);
    expect(pullRequestsByFinalTier(records).none).toBe(2);
    const table = pathAgainstFinalTier(records);
    expect(table.noTier).toBe(2);
    expect(table.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(0);
  });

  it("groups merges by base, with every feature branch as feature/*", () => {
    const rows = mergesByBaseAndTier([
      merged({ base: "main", tier: "general" }),
      merged({ base: "main", tier: "general" }),
      merged({ base: "main", tier: "general" }),
      merged({ base: "feature/export", tier: "authority" }),
      merged({ base: "feature/ledger", tier: "authority" }),
      merged({ base: "main", tier: null }),
    ]);
    expect(rows).toEqual([
      { base: "main", byTier: { authority: 0, sensitive: 0, general: 3, inert: 0 }, none: 1 },
      { base: "feature/*", byTier: { authority: 2, sensitive: 0, general: 0, inert: 0 }, none: 0 },
    ]);
  });
});
