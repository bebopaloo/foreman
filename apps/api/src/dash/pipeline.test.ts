import { describe, expect, it } from "vitest";
import {
  pipelineCounts,
  runningBuilds,
  waitsTotal,
  type CachedIssue,
  type CachedPullRequest,
} from "./pipeline.ts";

function issue(issueState: string, over: Partial<CachedIssue> = {}): CachedIssue {
  return {
    repoId: "r1",
    number: 1,
    title: "Synthetic",
    priority: "medium",
    link: null,
    state: "open",
    issueState,
    labels: [],
    hasChildren: false,
    ...over,
  };
}

const many = (count: number, make: () => CachedIssue): CachedIssue[] =>
  Array.from({ length: count }, make);

const production: CachedPullRequest = {
  repoId: "r1",
  number: 200,
  title: "Release",
  link: null,
  state: "open",
  baseBranch: "production",
};

describe("pipelineCounts", () => {
  it("counts each stage from the open issues, and the gate steps of the TODO issues", () => {
    const issues = [
      ...many(2, () => issue("TODO")),
      issue("TODO", { labels: ["spec-approved"] }),
      issue("TODO", { labels: ["spec-approved", "issues-approved"] }),
      issue("TODO", { labels: ["spec-approved", "finding"] }),
      ...many(3, () => issue("READY")),
      ...many(2, () => issue("IN PROGRESS")),
      issue("IN REVIEW"),
      issue("IN REVIEW", { labels: ["merge-ready"] }),
      issue("BLOCKED"),
      ...many(4, () => issue("DONE", { state: "closed" })),
      issue("DONE", { state: "closed", labels: ["merge-ready"] }),
      ...many(2, () => issue("", { state: "closed" })),
    ];
    expect(pipelineCounts(issues, [production])).toEqual({
      spec: 2,
      issues: 1,
      ready: 3,
      inProgress: 2,
      inReview: 1,
      blocked: 1,
      done: 5,
      release: 2,
    });
  });

  it("counts an issue with spec-waived in no stage", () => {
    const counts = pipelineCounts([issue("TODO", { labels: ["spec-waived"] })], []);
    expect(counts.spec + counts.issues).toBe(0);
  });

  it("ignores a closed issue in each stage other than DONE, and a closed pull request", () => {
    const counts = pipelineCounts(
      [
        issue("READY", { state: "closed" }),
        issue("IN REVIEW", { state: "closed", labels: ["merge-ready"] }),
      ],
      [
        { ...production, state: "closed" },
        { ...production, baseBranch: "main" },
      ],
    );
    expect(counts).toEqual({
      spec: 0,
      issues: 0,
      ready: 0,
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      done: 0,
      release: 0,
    });
  });
});

describe("waitsTotal", () => {
  it("counts BLOCKED, release, merge-ready and TODO issues with a next step", () => {
    const issues = [
      issue("BLOCKED"),
      issue("BLOCKED", { state: "closed" }),
      issue("IN REVIEW", { labels: ["merge-ready"] }),
      issue("TODO"),
      issue("TODO", { labels: ["spec-waived"] }),
      issue("TODO", { labels: ["finding"] }),
      issue("TODO", { labels: ["issues-approved"] }),
      issue("READY"),
    ];
    expect(waitsTotal(issues, [production])).toBe(5);
  });
});

describe("runningBuilds", () => {
  it("counts open leaf issues in IN PROGRESS or IN REVIEW without merge-ready, in enabled repos", () => {
    const issues = [
      issue("IN PROGRESS"),
      issue("IN REVIEW"),
      issue("IN REVIEW", { labels: ["merge-ready"] }),
      issue("IN PROGRESS", { hasChildren: true }),
      issue("IN PROGRESS", { repoId: "off" }),
      issue("IN PROGRESS", { state: "closed" }),
      issue("READY"),
    ];
    expect(runningBuilds(issues, new Set(["r1"]))).toBe(2);
  });
});
