import { describe, expect, it } from "vitest";
import { gate } from "../../test/control-event-fixtures.ts";
import {
  findingsByCategoryAndSeverity,
  mostFrequentRefs,
  securityFindings,
  securitySignals,
} from "./findings.ts";
import { pullRequestRecords } from "./pr-records.ts";

describe("securityFindings", () => {
  const events = [
    gate({
      pr: 42,
      tier: "sensitive",
      round: 1,
      decision: "fail",
      matrix: { Security: { major: 1, minor: 2 } },
    }),
    gate({
      pr: 42,
      tier: "sensitive",
      round: 2,
      decision: "pass",
      matrix: { Security: { minor: 1 } },
    }),
  ];

  it("sums the Security row of the round 1 events by severity and tier", () => {
    const result = securityFindings(pullRequestRecords(events), "round1");
    expect(result.bySeverity.major).toEqual({ sensitive: 1, total: 1 });
    expect(result.bySeverity.minor).toEqual({ sensitive: 2, total: 2 });
  });

  it("uses the settle event in the settle mode", () => {
    const result = securityFindings(pullRequestRecords(events), "settle");
    expect(result.bySeverity.major.total).toBe(0);
    expect(result.bySeverity.minor).toEqual({ sensitive: 1, total: 1 });
  });

  it("does not count a wait event", () => {
    const records = pullRequestRecords([
      gate({ pr: 43, tier: "sensitive", decision: "wait", matrix: { Security: { major: 1 } } }),
      gate({ pr: 43, tier: "sensitive", decision: "fail", matrix: { Testing: { minor: 1 } } }),
    ]);
    const result = securityFindings(records, "round1");
    expect(result.bySeverity.major.total).toBe(0);
    expect(result.withoutMatrix).toBe(0);
  });

  it("counts a pull request with no matrix as not counted, not as zero", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, tier: "general" }),
      gate({ pr: 2, tier: "general" }),
      gate({ pr: 3, tier: "general" }),
      gate({ pr: 4, tier: "general", matrix: {} }),
    ]);
    const result = securityFindings(records, "round1");
    expect(result.withoutMatrix).toBe(3);
    expect(result.bySeverity.major.total).toBe(0);
  });

  it("counts a matrix that is not valid as not counted", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, tier: "general", matrix: { Security: { major: "x" } } }),
    ]);
    expect(securityFindings(records, "round1").withoutMatrix).toBe(1);
  });

  it("puts a pull request with no tier in the none column", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, tier: null, matrix: { Security: { blocker: 2 } } }),
    ]);
    expect(securityFindings(records, "round1").bySeverity.blocker).toEqual({ none: 2, total: 2 });
  });

  it("does not count the settle event of a pull request that is not settled", () => {
    const records = pullRequestRecords([
      gate({ pr: 1, tier: "general", decision: "fail", matrix: { Security: { major: 1 } } }),
    ]);
    const result = securityFindings(records, "settle");
    expect(result.bySeverity.major.total).toBe(0);
    expect(result.withoutMatrix).toBe(0);
  });
});

describe("findingsByCategoryAndSeverity", () => {
  it("sums categories and counts of the chosen events", () => {
    const records = pullRequestRecords([
      gate({
        pr: 44,
        decision: "fail",
        categories: { Correctness: 2, Security: 1 },
        counts: { major: 2, minor: 1 },
      }),
      gate({ pr: 45, decision: "pass", categories: { Testing: 1 }, counts: { minor: 1 } }),
    ]);
    expect(findingsByCategoryAndSeverity(records, "round1")).toEqual({
      byCategory: [
        { name: "Correctness", count: 2 },
        { name: "Security", count: 1 },
        { name: "Testing", count: 1 },
      ],
      bySeverity: [
        { name: "major", count: 2 },
        { name: "minor", count: 2 },
      ],
    });
  });

  it("ignores an event with counts that are not valid", () => {
    const records = pullRequestRecords([gate({ pr: 1, counts: [1], categories: { A: -1 } })]);
    expect(findingsByCategoryAndSeverity(records, "round1")).toEqual({
      byCategory: [],
      bySeverity: [],
    });
  });
});

describe("mostFrequentRefs", () => {
  it("counts the distinct pull requests, shows 10 and the rest", () => {
    const events = [
      gate({ pr: 1, round: 1, decision: "fail", refs: ["CWE-639"] }),
      gate({ pr: 1, round: 2, decision: "pass", refs: ["CWE-639"] }),
      gate({ pr: 2, refs: ["CWE-639", "CWE-79"] }),
      gate({ pr: 3, refs: ["CWE-639", "CWE-79"] }),
      ...Array.from({ length: 11 }, (_, i) =>
        gate({ pr: 10 + i, decision: "wait", refs: [`REF-${String(i).padStart(2, "0")}`] }),
      ),
    ];
    const result = mostFrequentRefs(events);
    expect(result.refs.slice(0, 3)).toEqual([
      { ref: "CWE-639", pullRequests: 3 },
      { ref: "CWE-79", pullRequests: 2 },
      { ref: "REF-00", pullRequests: 1 },
    ]);
    expect(result.refs).toHaveLength(10);
    expect(result.refs[9]).toEqual({ ref: "REF-07", pullRequests: 1 });
    expect(result.more).toBe(3);
  });

  it("keeps the same pull request number in two repos apart", () => {
    const result = mostFrequentRefs([
      gate({ pr: 1, repo: "acme/a", refs: ["X"] }),
      gate({ pr: 1, repo: "acme/b", refs: ["X"] }),
    ]);
    expect(result).toEqual({ refs: [{ ref: "X", pullRequests: 2 }], more: 0 });
  });

  it("skips an event whose refs are not valid", () => {
    expect(mostFrequentRefs([gate({ pr: 1, refs: "CWE-1" })])).toEqual({ refs: [], more: 0 });
  });
});

describe("securitySignals", () => {
  const events = [
    gate({
      pr: 46,
      tier: "general",
      round: 1,
      decision: "fail",
      matrix: { Security: { minor: 1 } },
    }),
    gate({
      pr: 46,
      tier: "general",
      round: 2,
      decision: "pass",
      matrix: { Security: { minor: 1 } },
    }),
    gate({ pr: 47, tier: "inert", matrix: { Security: { info: 3 } } }),
    gate({ pr: 48, tier: "sensitive", matrix: { Security: { major: 1 } } }),
    gate({ pr: 49, tier: null, matrix: { Security: { major: 1 } } }),
  ];

  it("lists only the general and inert pull requests with a blocker, major or minor finding", () => {
    const result = securitySignals(events, pullRequestRecords(events));
    expect(result).toEqual({
      signals: [{ repo: "acme/app", pr: 46, tier: "general", blocker: 0, major: 0, minor: 1 }],
      more: 0,
    });
  });

  it("takes the highest count of one decision event and skips a wait event", () => {
    const more = [
      gate({
        pr: 5,
        tier: "inert",
        round: 1,
        decision: "wait",
        matrix: { Security: { major: 9 } },
      }),
      gate({
        pr: 5,
        tier: "inert",
        round: 1,
        decision: "fail",
        matrix: { Security: { major: 2 } },
      }),
      gate({
        pr: 5,
        tier: "inert",
        round: 2,
        decision: "pass",
        matrix: { Security: { major: 1 } },
      }),
    ];
    expect(securitySignals(more, pullRequestRecords(more)).signals[0]).toMatchObject({
      pr: 5,
      major: 2,
    });
  });

  it("shows the first 20 by repo and number, and the count of the rest", () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      gate({ pr: 100 - i, tier: "general", matrix: { Security: { minor: 1 } } }),
    );
    const result = securitySignals(many, pullRequestRecords(many));
    expect(result.signals).toHaveLength(20);
    expect(result.signals[0]?.pr).toBe(78);
    expect(result.more).toBe(3);
  });
});
