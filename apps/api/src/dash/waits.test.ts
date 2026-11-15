import { WAITS_LIMIT } from "@foreman/shared";
import { describe, expect, it } from "vitest";
import { waitsTotal, type CachedIssue, type CachedPullRequest } from "./pipeline.ts";
import { waitsOf } from "./waits.ts";

let counter = 0;

function issue(issueState: string, over: Partial<CachedIssue> = {}): CachedIssue {
  counter += 1;
  return {
    repoId: "r1",
    number: counter,
    title: `Synthetic ${counter.toString()}`,
    priority: "medium",
    link: `https://example.test/issues/${counter.toString()}`,
    state: "open",
    issueState,
    labels: [],
    hasChildren: false,
    ...over,
  };
}

function pull(over: Partial<CachedPullRequest> = {}): CachedPullRequest {
  counter += 1;
  return {
    repoId: "r1",
    number: counter,
    title: "Release 1.2",
    link: `https://example.test/pull/${counter.toString()}`,
    state: "open",
    baseBranch: "production",
    ...over,
  };
}

const repos = new Map([
  ["r1", "acme/app"],
  ["r2", "acme/site"],
]);

const run = (
  issues: CachedIssue[],
  pulls: CachedPullRequest[] = [],
  blockedReasons: Map<string, string> = new Map(),
) => waitsOf({ issues, pulls, repoLabels: repos, blockedReasons });

describe("waitsOf", () => {
  it("orders BLOCKED, release, merge-ready and TODO items, and each group by priority", () => {
    const high = issue("BLOCKED", { priority: "high", title: "Blocked high" });
    const low = issue("BLOCKED", { priority: "low", title: "Blocked low" });
    const ready = issue("IN REVIEW", { labels: ["merge-ready"], title: "Merge ready" });
    const spec = issue("TODO", { priority: "medium", title: "Needs spec" });
    const waived = issue("TODO", { priority: "low", labels: ["spec-waived"], title: "Waived" });
    const release = pull();
    const waits = run([waived, spec, ready, low, high], [release]);
    expect(waits.items.map((item) => [item.kind, item.title, item.reason, item.source])).toEqual([
      ["blocked", "Blocked high", "see the comment in the tracker", "tracker"],
      ["blocked", "Blocked low", "see the comment in the tracker", "tracker"],
      ["release", "Release 1.2", "Release to perform", "forge"],
      ["merge_ready", "Merge ready", "merge-ready, waits for G3", "tracker"],
      ["todo", "Needs spec", "Spec and G1", "tracker"],
      ["todo", "Waived", "make it READY", "tracker"],
    ]);
    expect(waits.items[0]).toMatchObject({
      repo: "acme/app",
      repoId: "r1",
      number: high.number,
      link: high.link,
    });
  });

  it("orders equal priorities by number, then by owner and name", () => {
    const later = issue("BLOCKED", { repoId: "r1", number: 9 });
    const earlier = issue("BLOCKED", { repoId: "r2", number: 4 });
    const sameNumber = issue("BLOCKED", { repoId: "r2", number: 9 });
    const none = issue("BLOCKED", { priority: "", number: 1 });
    const waits = run([none, sameNumber, later, earlier]);
    expect(waits.items.map((item) => `${item.repo}#${item.number.toString()}`)).toEqual([
      "acme/site#4",
      "acme/app#9",
      "acme/site#9",
      "acme/app#1",
    ]);
  });

  it("gives the reason of the newest night log line of a BLOCKED issue", () => {
    const blocked = issue("BLOCKED");
    const other = issue("BLOCKED");
    const reasons = new Map([
      [`r1#${blocked.number.toString()}`, "auto mode refused the migration"],
    ]);
    const waits = run([blocked, other], [], reasons);
    expect(waits.items.map((item) => [item.reason, item.source])).toEqual([
      ["auto mode refused the migration", "night log"],
      ["see the comment in the tracker", "tracker"],
    ]);
  });

  it("leaves out closed issues, findings, approved issue lists and other states", () => {
    const waits = run(
      [
        issue("BLOCKED", { state: "closed" }),
        issue("TODO", { labels: ["finding"] }),
        issue("TODO", { labels: ["spec-approved", "issues-approved"] }),
        issue("IN REVIEW"),
        issue("READY"),
        issue("TODO", { labels: ["spec-approved"] }),
      ],
      [pull({ baseBranch: "main" }), pull({ state: "closed" })],
    );
    expect(waits.items.map((item) => item.reason)).toEqual(["G2"]);
  });

  it("shows the first 20 items and counts all of them, as the tile does", () => {
    const issues = Array.from({ length: 30 }, () => issue("BLOCKED"));
    const waits = run(issues);
    expect(waits.items).toHaveLength(WAITS_LIMIT);
    expect(waits.total).toBe(30);
    expect(waits.total).toBe(waitsTotal(issues, []));
  });

  it("has the same total as the tile for each kind of item", () => {
    const issues = [
      issue("BLOCKED"),
      issue("IN REVIEW", { labels: ["merge-ready"] }),
      issue("TODO"),
      issue("TODO", { labels: ["finding"] }),
      issue("TODO", { labels: ["spec-waived"] }),
    ];
    const pulls = [pull()];
    expect(run(issues, pulls).total).toBe(waitsTotal(issues, pulls));
  });

  it("has no items when nothing waits", () => {
    expect(run([issue("READY")])).toEqual({ total: 0, items: [] });
  });
});
