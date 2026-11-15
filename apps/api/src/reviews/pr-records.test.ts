import { describe, expect, it } from "vitest";
import { escalated, gate } from "../../test/control-event-fixtures.ts";
import { pullRequestRecords, withoutMatrix } from "./pr-records.ts";

describe("pullRequestRecords", () => {
  it("has no record for no gate decision event", () => {
    expect(pullRequestRecords([])).toEqual([]);
    expect(
      pullRequestRecords([escalated({ pr: 5, path_tier: "general", tier: "sensitive" })]),
    ).toEqual([]);
  });

  it("takes the highest tier of the gate and escalated events as the final tier", () => {
    const [record, ...rest] = pullRequestRecords([
      gate({ pr: 40, tier: "general", round: 1, decision: "fail" }),
      escalated({ pr: 40, path_tier: "general", tier: "authority" }),
      gate({ pr: 40, tier: "authority", round: 2, decision: "pass" }),
    ]);
    expect(rest).toEqual([]);
    expect(record).toMatchObject({
      pr: 40,
      finalTier: "authority",
      pathTier: "general",
      escalated: true,
      rounds: 2,
    });
  });

  it("never lowers the tier", () => {
    const [record] = pullRequestRecords([
      gate({ pr: 1, tier: "sensitive", decision: "fail" }),
      gate({ pr: 1, tier: "inert", round: 2 }),
    ]);
    expect(record?.finalTier).toBe("sensitive");
  });

  it("gives a pull request with no escalation the path tier of its final tier", () => {
    const [record] = pullRequestRecords([gate({ pr: 41, tier: "sensitive" })]);
    expect(record).toMatchObject({
      finalTier: "sensitive",
      pathTier: "sensitive",
      escalated: false,
    });
  });

  it("gives a pull request with no tier a null final tier", () => {
    const records = pullRequestRecords([gate({ pr: 1 }), gate({ pr: 2, decision: "fail" })]);
    expect(records.map((r) => [r.finalTier, r.pathTier])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("keeps the same pull request number in two repos apart", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, repo: "acme/app", tier: "general" }),
      gate({ pr: 1, repo: "globex/portal", tier: "inert" }),
    ]);
    expect(records.map((r) => r.finalTier)).toEqual(["general", "inert"]);
  });

  it("does not count a wait event as a decision", () => {
    const [record] = pullRequestRecords([
      gate({ pr: 43, decision: "wait", matrix: { Security: { major: 1 } } }),
      gate({ pr: 43, decision: "fail" }),
    ]);
    expect(record?.roundOneEvent?.decision).toBe("fail");
    expect(record?.roundOneEvent?.matrix).toBeUndefined();
    expect(record?.settleEvent).toBeNull();
  });

  it("has no decision for a pull request with only wait events", () => {
    const [record] = pullRequestRecords([gate({ pr: 9, decision: "wait" })]);
    expect(record).toMatchObject({
      rounds: 1,
      roundOneEvent: null,
      lastDecisionEvent: null,
      settleEvent: null,
    });
  });

  it("settles on a last decision of pass or blocked, and not on fail", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, round: 1, decision: "fail" }),
      gate({ pr: 1, round: 2, decision: "pass" }),
      gate({ pr: 2, round: 3, decision: "blocked" }),
      gate({ pr: 3, round: 1, decision: "fail" }),
    ]);
    expect(
      records.map((r) => [r.settleEvent?.decision ?? null, r.settleEvent?.round ?? null]),
    ).toEqual([
      ["pass", 2],
      ["blocked", 3],
      [null, null],
    ]);
  });

  it("counts pull requests whose round 1 event has no matrix", () => {
    const records = pullRequestRecords([
      gate({ pr: 1 }),
      gate({ pr: 2, decision: "fail" }),
      gate({ pr: 3 }),
      gate({ pr: 4, matrix: { Security: { minor: 1 } } }),
      gate({ pr: 5, decision: "wait" }),
    ]);
    expect(withoutMatrix(records)).toBe(3);
  });
});
