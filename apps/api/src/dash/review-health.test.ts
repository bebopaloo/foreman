import { describe, expect, it } from "vitest";
import type { ControlEvent } from "./control-events.ts";
import { reviewHealth, type ConnectedRepo } from "./review-health.ts";

let tick = 0;
function gate(over: Record<string, unknown>): ControlEvent {
  tick += 1;
  return {
    kind: "gate",
    repo: "acme/app",
    time: "2026-11-15T10:00:00Z",
    at: new Date(Date.UTC(2026, 10, 15, 10, 0, tick)),
    pr: 1,
    issue: null,
    tier: "general",
    round: 1,
    decision: "pass",
    counts: {},
    categories: [],
    refs: [],
    waived: [],
    ...over,
  };
}

function other(kind: "escalated" | "waiver_used", over: Record<string, unknown>): ControlEvent {
  const base = { repo: "acme/app", time: "2026-11-15T10:00:00Z", at: new Date(), pr: 1, ...over };
  return kind === "escalated"
    ? { kind, issue: null, path_tier: null, tier: null, paths: [], evidence: [], ...base }
    : { kind, waiver: "W-1", finding: "f", ...base };
}

const run = (events: ControlEvent[], extra: Partial<Parameters<typeof reviewHealth>[0]> = {}) =>
  reviewHealth({ events, scopeRepos: null, connected: [], factoryLoginSet: true, ...extra });

describe("reviewHealth", () => {
  it("rates the first round for each Risk tier and for no tier", () => {
    const health = run([
      gate({ pr: 1, tier: "general", decision: "pass" }),
      gate({ pr: 2, tier: "general", decision: "fail" }),
      gate({ pr: 3, tier: "sensitive", decision: "pass" }),
      gate({ pr: 4, tier: null, decision: "fail" }),
    ]);
    expect(health.firstRound).toMatchObject({ rate: 50, passed: 2, total: 4 });
    expect(health.firstRound.tiers).toEqual([
      { tier: "general", passed: 1, total: 2, rate: 50 },
      { tier: "sensitive", passed: 1, total: 1, rate: 100 },
      { tier: null, passed: 0, total: 1, rate: 0 },
    ]);
  });

  it("counts a pull request once, with its first round 1 pass or fail", () => {
    const health = run([
      gate({ pr: 7, round: 1, decision: "wait", tier: "x" }),
      gate({ pr: 7, round: 1, decision: "fail", tier: "general" }),
      gate({ pr: 7, round: 2, decision: "pass", tier: "sensitive" }),
    ]);
    expect(health.firstRound).toMatchObject({ rate: 0, passed: 0, total: 1 });
    expect(health.firstRound.tiers).toEqual([{ tier: "general", passed: 0, total: 1, rate: 0 }]);
  });

  it("counts pull request 7 of two repos as two pull requests", () => {
    const health = run([gate({ repo: "acme/app", pr: 7 }), gate({ repo: "acme/site", pr: 7 })]);
    expect(health.firstRound.total).toBe(2);
  });

  it("has no rate with no round 1 decision of pass or fail", () => {
    const health = run([gate({ decision: "wait" }), gate({ pr: 2, round: 2 })]);
    expect(health.firstRound).toEqual({ rate: null, passed: 0, total: 0, tiers: [] });
  });

  it("counts the rounds from the highest round of each pull request", () => {
    const health = run([
      gate({ pr: 1, round: 1 }),
      gate({ pr: 2, round: 1, decision: "fail" }),
      gate({ pr: 2, round: 2 }),
      gate({ pr: 3, round: 1, decision: "fail" }),
      gate({ pr: 3, round: 2, decision: "fail" }),
      gate({ pr: 3, round: 3, decision: "blocked" }),
      gate({ pr: 4, round: 2, decision: "wait" }),
    ]);
    expect(health.rounds).toEqual({ one: 1, two: 2, three: 1 });
  });

  it("counts escalations and distinct Waivers of each repo", () => {
    const health = run([
      other("escalated", { pr: 1 }),
      other("escalated", { pr: 2 }),
      other("escalated", { pr: 3, repo: "acme/site" }),
      other("waiver_used", { pr: 1 }),
      other("waiver_used", { pr: 2 }),
      other("waiver_used", { pr: 3, repo: "acme/site" }),
    ]);
    expect(health.escalations).toBe(3);
    expect(health.waiversInUse).toBe(2);
  });

  it("uses only the events of the repos in scope", () => {
    const health = run([gate({ repo: "Acme/App" }), gate({ repo: "globex/portal" })], {
      scopeRepos: new Set(["acme/app"]),
    });
    expect(health.firstRound.total).toBe(1);
  });

  describe("repos with no Control events", () => {
    const repos: ConnectedRepo[] = [
      { id: "a", label: "acme/app", factory: { reviewed: 3, unreviewed: 1 } },
      { id: "b", label: "acme/site", factory: { reviewed: 0, unreviewed: 0 } },
    ];

    it("lists the connected repos that have no event, with the factory counts", () => {
      const health = run([gate({ repo: "acme/site" })], { connected: repos });
      expect(health.reposWithoutControls).toEqual([
        { repoId: "a", repo: "acme/app", reviewed: 3, unreviewed: 1 },
      ]);
    });

    it("shows no counts when no Factory identity login is set", () => {
      const health = run([], { connected: repos, factoryLoginSet: false });
      expect(health.factoryLoginSet).toBe(false);
      expect(health.reposWithoutControls.map((r) => [r.reviewed, r.unreviewed])).toEqual([
        [null, null],
        [null, null],
      ]);
    });
  });
});
