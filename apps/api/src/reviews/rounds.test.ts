import { describe, expect, it } from "vitest";
import { pullRequestRecords } from "./pr-records.ts";
import { gate } from "../../test/control-event-fixtures.ts";
import { roundsToSettle } from "./rounds.ts";

const T = "sensitive";

describe("roundsToSettle", () => {
  it("has no row for no pull request", () => {
    expect(roundsToSettle(pullRequestRecords([]))).toEqual([]);
  });

  it("counts the outcomes of a tier, and a wait event is no decision", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, tier: T, round: 1, decision: "pass" }),
      gate({ pr: 2, tier: T, round: 1, decision: "fail" }),
      gate({ pr: 2, tier: T, round: 2, decision: "pass" }),
      gate({ pr: 3, tier: T, round: 1, decision: "fail" }),
      gate({ pr: 3, tier: T, round: 2, decision: "fail" }),
      gate({ pr: 3, tier: T, round: 3, decision: "blocked" }),
      gate({ pr: 4, tier: T, round: 1, decision: "fail" }),
      gate({ pr: 5, tier: T, round: 1, decision: "wait" }),
    ]);
    expect(roundsToSettle(records)).toEqual([
      {
        tier: T,
        pullRequests: 5,
        settledInRound: [1, 1, 0],
        blocked: 1,
        notSettled: 2,
        withDecision: 4,
        lastGatePassPercent: 50,
      },
    ]);
  });

  it("orders the tiers from authority to inert, then no tier, and rounds the rate", () => {
    const records = pullRequestRecords([
      gate({ pr: 1 }),
      gate({ pr: 2, tier: "inert" }),
      gate({ pr: 3, tier: "authority", decision: "fail" }),
      gate({ pr: 4, tier: "inert", decision: "fail" }),
      gate({ pr: 5, tier: "inert", decision: "fail" }),
    ]);
    const rows = roundsToSettle(records);
    expect(rows.map((row) => row.tier)).toEqual(["authority", "inert", null]);
    expect(rows[1]).toMatchObject({ pullRequests: 3, lastGatePassPercent: 33 });
    expect(rows[0]).toMatchObject({ lastGatePassPercent: 0, notSettled: 1 });
  });

  it("has no last-gate pass rate when no pull request has a decision", () => {
    const rows = roundsToSettle(pullRequestRecords([gate({ pr: 1, tier: T, decision: "wait" })]));
    expect(rows[0]).toMatchObject({ withDecision: 0, lastGatePassPercent: null, notSettled: 1 });
  });
});
