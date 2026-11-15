import { describe, expect, it } from "vitest";
import { gate } from "../../test/control-event-fixtures.ts";
import type { ControlEvent } from "../dash/control-events.ts";
import type { NightLogEntry } from "../dash/night-log.ts";
import { folderLabel, runsInWindow, type RunRepo } from "../dash/runs.ts";
import { repoId } from "../work/repo-list.ts";
import { pullRequestRecords } from "./pr-records.ts";
import type { AgentSpan } from "../sessions/spans.ts";
import { buildTimes, timesByTier, type BuildTimeRow } from "./times.ts";

const at = (clock: string): Date => new Date(`2026-11-14T${clock}:00Z`);
const NOW = new Date("2026-11-15T12:00:00Z");
const ACME_ID = repoId("github.com", "acme", "app");
const ACME: RunRepo = { key: ACME_ID, id: ACME_ID, label: "acme/app", client: null };

function line(over: Partial<NightLogEntry> & { clock: string }): NightLogEntry {
  const { clock, ...rest } = over;
  return {
    runId: "run-1",
    repo: "/s/acme/app",
    issue: 12,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: at(clock),
    ...rest,
  };
}

function gateAt(clock: string, over: Parameters<typeof gate>[0]): ControlEvent {
  return gate({ ...over, at: at(clock), time: `2026-11-14T${clock}:00Z` });
}

function times(entries: NightLogEntry[], events: ControlEvent[], spans: AgentSpan[] = []) {
  const runs = runsInWindow({
    entries,
    repoOf: (folder) =>
      folder === "/s/acme/app"
        ? ACME
        : { key: folder, id: null, label: folderLabel(folder), client: null },
    isParent: () => false,
    scope: { kind: "all" },
    lockRunId: null,
    now: NOW,
  });
  return buildTimes({
    runs,
    events,
    records: pullRequestRecords(events),
    spans,
    repoKeyOf: (project) => (project === "/src/acme-app" ? ACME_ID : project),
  });
}

const merged40 = line({
  clock: "02:30",
  from: "IN REVIEW",
  to: "DONE",
  reason: "merged #40",
});

describe("buildTimes", () => {
  it("takes the build end from the first gate event of the pull request", () => {
    const result = times(
      [line({ clock: "01:00" }), merged40],
      [
        gateAt("01:50", { pr: 40, issue: 12, tier: "sensitive", round: 1, decision: "fail" }),
        gateAt("02:20", { pr: 40, issue: 12, tier: "sensitive", round: 2, decision: "pass" }),
      ],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      pr: 40,
      finalTier: "sensitive",
      rounds: 2,
      buildSeconds: 50 * 60,
      reviewCycleSeconds: 40 * 60,
      totalSeconds: 90 * 60,
      buildEnd: { source: "first gate event", at: at("01:50") },
    });
  });

  it("shows the total and no build end when no gate event is in the build window", () => {
    const result = times(
      [line({ clock: "01:00" }), merged40],
      [gateAt("03:00", { pr: 40, issue: 12 }), gateAt("00:30", { pr: 40, issue: 12 })],
    );
    expect(result.rows[0]).toMatchObject({
      pr: 40,
      totalSeconds: 90 * 60,
      buildEnd: null,
      buildSeconds: null,
      reviewCycleSeconds: null,
    });
  });

  it("takes the newest pull request of the issue in the window when the reason has no number", () => {
    const result = times(
      [
        line({ clock: "01:00" }),
        line({ clock: "02:40", from: "IN PROGRESS", to: "BLOCKED", reason: "review blocked" }),
      ],
      [
        gateAt("01:50", { pr: 40, issue: 12 }),
        gateAt("02:10", { pr: 41, issue: 12 }),
        gateAt("02:00", { pr: 99, issue: 13 }),
      ],
    );
    expect(result.rows.map((row) => row.pr)).toEqual([41]);
    expect(result.rows[0]?.buildEnd?.at).toEqual(at("02:10"));
  });

  it("counts a build with no pull request", () => {
    const result = times(
      [
        line({ clock: "01:00", issue: 13 }),
        line({ clock: "02:00", issue: 13, from: "IN PROGRESS", to: "BLOCKED", reason: "stuck" }),
      ],
      [gateAt("01:30", { pr: 5, issue: 14 })],
    );
    expect(result).toEqual({
      rows: [],
      noPullRequest: 1,
      notTimed: 0,
      reviewAgentSpansNotLinked: 0,
    });
  });

  it("gives no row to a build in two runs and counts it once", () => {
    const result = times(
      [
        line({ clock: "01:00", issue: 15, runId: "run-1" }),
        line({
          clock: "02:00",
          issue: 15,
          runId: "run-1",
          from: "IN PROGRESS",
          to: "IN REVIEW",
          reason: "opened #52",
        }),
        line({
          clock: "05:00",
          issue: 15,
          runId: "run-2",
          from: "IN REVIEW",
          to: "DONE",
          reason: "merged #52",
        }),
      ],
      [],
    );
    expect(result).toEqual({
      rows: [],
      noPullRequest: 0,
      notTimed: 1,
      reviewAgentSpansNotLinked: 0,
    });
  });

  it("gives no row and no count to a cancelled build", () => {
    const result = times(
      [
        line({ clock: "01:00" }),
        line({ clock: "01:10", from: "IN PROGRESS", to: "CANCELLED", reason: "x" }),
      ],
      [],
    );
    expect(result).toEqual({
      rows: [],
      noPullRequest: 0,
      notTimed: 0,
      reviewAgentSpansNotLinked: 0,
    });
  });

  it("uses the pull request of the reason for a repo that is not in the repo list", () => {
    const result = times(
      [
        line({ clock: "01:00", repo: "/s/other" }),
        line({
          clock: "02:00",
          repo: "/s/other",
          from: "IN REVIEW",
          to: "DONE",
          reason: "merged #7",
        }),
      ],
      [],
    );
    expect(result.rows[0]).toMatchObject({ pr: 7, finalTier: null, rounds: null, buildEnd: null });
  });
});

function span(
  agentType: string,
  from: string,
  to: string,
  over: Partial<AgentSpan> = {},
): AgentSpan {
  return {
    key: `a:${agentType}-${from}`,
    kind: "sub-agent",
    sessionId: "s1",
    agentType,
    skill: null,
    skillBasis: null,
    models: [],
    projectKey: "/src/acme-app",
    workRefs: [{ projectKey: "/src/acme-app", number: 12 }],
    start: at(from),
    end: at(to),
    turns: 2,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    tokens: 0,
    ...over,
  };
}

const BUILD = [
  line({ clock: "01:00" }),
  line({ clock: "02:30", from: "IN REVIEW", to: "DONE", reason: "merged #40" }),
];

describe("buildTimes with Agent spans", () => {
  it("takes the build end from the last Turn of the linked software-developer span", () => {
    const result = times(
      BUILD,
      [gateAt("01:50", { pr: 40, issue: 12 })],
      [span("factory-core:software-developer", "01:02", "01:35")],
    );
    expect(result.rows[0]).toMatchObject({
      buildEnd: { source: "agent span", at: at("01:35") },
      buildSeconds: 35 * 60,
      reviewCycleSeconds: 55 * 60,
    });
  });

  it("uses the first gate event when no software-developer span links", () => {
    const other = span("software-developer", "01:02", "01:35", {
      workRefs: [{ projectKey: "/src/acme-app", number: 13 }],
    });
    const result = times(BUILD, [gateAt("01:50", { pr: 40, issue: 12 })], [other]);
    expect(result.rows[0]?.buildEnd).toEqual({ source: "first gate event", at: at("01:50") });
  });

  it("does not link a span whose first Turn is outside the build window", () => {
    const early = span("software-developer", "00:50", "01:35");
    expect(times(BUILD, [], [early]).rows[0]?.buildEnd).toBeNull();
  });

  it("does not use a build end after the settle", () => {
    const late = span("software-developer", "02:00", "02:45");
    expect(times(BUILD, [], [late]).rows[0]?.buildEnd).toBeNull();
  });

  it("does not link a span of another repo", () => {
    const foreign = span("software-developer", "01:02", "01:35", {
      workRefs: [{ projectKey: "/src/other", number: 12 }],
    });
    expect(times(BUILD, [], [foreign]).rows[0]?.buildEnd).toBeNull();
  });

  it("splits the Review cycle into review agents, resolver and other", () => {
    const result = times(
      BUILD,
      [],
      [
        span("software-developer", "01:02", "01:40"),
        span("review-finder", "01:40", "01:50"),
        span("factory-core:review-finder", "01:42", "01:55"),
        span("review-verifier", "01:55", "02:00"),
        span("review-resolver", "02:05", "02:15"),
      ],
    );
    expect(result.rows[0]?.split).toEqual({
      reviewAgentsSeconds: 20 * 60,
      resolverSeconds: 10 * 60,
      otherSeconds: 20 * 60,
    });
  });

  it("counts a resolver minute that a review agent also covers as review agent time", () => {
    const result = times(
      BUILD,
      [],
      [
        span("software-developer", "01:02", "01:40"),
        span("review-finder", "01:40", "01:50"),
        span("review-resolver", "01:45", "01:55"),
      ],
    );
    expect(result.rows[0]?.split).toEqual({
      reviewAgentsSeconds: 10 * 60,
      resolverSeconds: 5 * 60,
      otherSeconds: 35 * 60,
    });
  });

  it("gives no split with no linked review or resolver span", () => {
    const result = times(BUILD, [], [span("software-developer", "01:02", "01:35")]);
    expect(result.rows[0]?.split).toBeNull();
  });

  it("counts the review spans that have no single work item", () => {
    const result = times(
      BUILD,
      [gateAt("01:40", { pr: 40, issue: 12 })],
      [
        span("review-finder", "01:40", "01:50", { workRefs: [] }),
        span("review-verifier", "01:55", "02:00", {
          workRefs: [
            { projectKey: "/src/acme-app", number: 12 },
            { projectKey: "/src/acme-app", number: 13 },
          ],
        }),
        span("software-developer", "01:02", "01:05", { workRefs: [] }),
        span("review-finder", "01:41", "01:50"),
      ],
    );
    expect(result.reviewAgentSpansNotLinked).toBe(2);
    expect(result.rows[0]?.split?.reviewAgentsSeconds).toBe(9 * 60);
  });
});

function row(over: Partial<BuildTimeRow>): BuildTimeRow {
  return {
    repo: ACME,
    issue: 1,
    pr: 1,
    finalTier: "sensitive",
    rounds: 1,
    start: at("01:00"),
    settle: at("03:00"),
    totalSeconds: 0,
    buildEnd: { at: at("01:30"), source: "agent span" },
    buildSeconds: 0,
    reviewCycleSeconds: 0,
    split: null,
    ...over,
  };
}

describe("timesByTier", () => {
  it("gives the medians and the review share of the agent span rows", () => {
    const rows = [
      [30, 20],
      [40, 50],
      [60, 80],
    ].map(([build = 0, cycle = 0], index) =>
      row({ pr: index + 1, buildSeconds: build * 60, reviewCycleSeconds: cycle * 60 }),
    );
    expect(timesByTier(rows)).toEqual([
      {
        tier: "sensitive",
        pullRequests: 3,
        timed: 3,
        medianBuildSeconds: 40 * 60,
        medianReviewCycleSeconds: 50 * 60,
        meanRounds: 1,
        reviewSharePercent: 54,
      },
    ]);
  });

  it("leaves a first gate event row out of the medians and the share", () => {
    const rows = [
      row({ buildSeconds: 600, reviewCycleSeconds: 600 }),
      row({
        pr: 2,
        buildSeconds: 6000,
        reviewCycleSeconds: 60,
        buildEnd: { at: at("02:00"), source: "first gate event" },
      }),
      row({ pr: 3, buildEnd: null, buildSeconds: null, reviewCycleSeconds: null }),
    ];
    expect(timesByTier(rows)[0]).toMatchObject({
      pullRequests: 3,
      timed: 1,
      medianBuildSeconds: 600,
      medianReviewCycleSeconds: 600,
      reviewSharePercent: 50,
    });
  });

  it("rounds the median of an even count to a whole minute", () => {
    const rows = [600, 690].map((build, index) =>
      row({ pr: index + 1, buildSeconds: build, reviewCycleSeconds: 60 }),
    );
    expect(timesByTier(rows)[0]?.medianBuildSeconds).toBe(660);
  });

  it("gives null with no timed row and no gate event, and puts no tier last", () => {
    const rows = [
      row({
        finalTier: null,
        rounds: null,
        buildEnd: null,
        buildSeconds: null,
        reviewCycleSeconds: null,
      }),
      row({ pr: 2, finalTier: "inert" }),
    ];
    const result = timesByTier(rows);
    expect(result.map((tier) => tier.tier)).toEqual(["inert", null]);
    expect(result[1]).toMatchObject({
      timed: 0,
      medianBuildSeconds: null,
      medianReviewCycleSeconds: null,
      meanRounds: null,
      reviewSharePercent: null,
    });
  });
});
