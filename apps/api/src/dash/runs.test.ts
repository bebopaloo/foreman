import { describe, expect, it } from "vitest";
import type { NightLogEntry } from "./night-log.ts";
import { folderLabel, runsInWindow, type RunRepo, type RunScope } from "./runs.ts";

const DAY = "2026-11-14";
const at = (clock: string, day: string = DAY): Date => new Date(`${day}T${clock}:00Z`);
const NOW = new Date("2026-11-15T12:00:00Z");

const ACME: RunRepo = { key: "r-acme", id: "r-acme", label: "acme/app", client: "acme" };
const GLOBEX: RunRepo = {
  key: "r-globex",
  id: "r-globex",
  label: "globex/portal",
  client: "globex",
};
const FOLDERS: Record<string, RunRepo> = {
  "/s/acme/app": ACME,
  "/s/globex/portal": GLOBEX,
};

function line(over: Partial<NightLogEntry> & { clock: string; day?: string }): NightLogEntry {
  const { clock, day, ...rest } = over;
  return {
    runId: "run-1",
    repo: "/s/acme/app",
    issue: 1,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: at(clock, day),
    pr: null,
    ...rest,
  };
}

function runs(
  entries: NightLogEntry[],
  options: { scope?: RunScope; lockRunId?: string | null; parents?: string[] } = {},
) {
  return runsInWindow({
    entries,
    repoOf: (folder) =>
      FOLDERS[folder] ?? { key: folder, id: null, label: folderLabel(folder), client: null },
    isParent: (repo, issue) => (options.parents ?? []).includes(`${repo.key}#${issue.toString()}`),
    scope: options.scope ?? { kind: "all" },
    lockRunId: options.lockRunId ?? null,
    now: NOW,
  });
}

const summary = (run: ReturnType<typeof runs>[number] | undefined) =>
  run?.builds.map((b) => `${b.issue.toString()}:${b.lane.toString()}:${b.result}`);

describe("runsInWindow", () => {
  it("puts builds in the lowest free lane and gives each a result", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({ issue: 2, clock: "01:10" }),
      line({ issue: 4, clock: "01:20" }),
      line({ issue: 1, clock: "03:00", from: "IN REVIEW", to: "DONE", reason: "merged #40" }),
      line({
        issue: 2,
        clock: "04:00",
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "merge-ready #41",
      }),
      line({ issue: 3, clock: "03:30" }),
      line({ issue: 3, clock: "05:00", from: "IN PROGRESS", to: "BLOCKED", reason: "gate failed" }),
    ]);
    expect(summary(run)).toEqual([
      "1:1:merged",
      "2:2:merge-ready",
      "4:3:stopped at run end",
      "3:1:blocked",
    ]);
    expect(run?.lanes).toBe(3);
    const d = run?.builds.find((b) => b.issue === 4);
    expect(d?.end).toEqual(at("05:00"));
  });

  it("ends a build at a cancelled line and keeps one in review that ends at the window end", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({ issue: 2, clock: "01:00" }),
      line({ issue: 1, clock: "02:00", from: "IN PROGRESS", to: "CANCELLED", reason: "stop" }),
      line({
        issue: 2,
        clock: "03:00",
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "pull request open",
      }),
    ]);
    expect(summary(run)).toEqual(["1:1:cancelled", "2:2:in review"]);
  });

  it("counts a skip and makes no bar for it", () => {
    const skips = Array.from({ length: 9 }, (_, n) =>
      line({ issue: 20 + n, clock: "02:00", from: "READY", to: "READY", reason: "blocked by #3" }),
    );
    const [run] = runs([line({ issue: 1, clock: "01:00" }), ...skips]);
    expect(run?.skips).toBe(9);
    expect(run?.builds).toHaveLength(1);
  });

  it("starts a build with no start line at the start of the window", () => {
    const [run] = runs([
      line({ issue: 9, clock: "01:00", from: "READY", to: "IN PROGRESS" }),
      line({ issue: 12, clock: "03:00", from: "IN REVIEW", to: "DONE", reason: "merged #40" }),
    ]);
    const build = run?.builds.find((b) => b.issue === 12);
    expect(build).toMatchObject({ result: "merged", start: at("01:00"), end: at("03:00") });
  });

  it("counts a line from READY to BLOCKED with no earlier line as blocked at selection", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({ issue: 15, clock: "02:00", from: "READY", to: "BLOCKED", reason: "no token" }),
    ]);
    expect(run?.blockedAtSelection).toBe(1);
    expect(run?.builds.map((b) => b.issue)).toEqual([1]);
  });

  it("makes a build of a blocked line that follows an earlier line of the issue", () => {
    const [run] = runs([
      line({ issue: 15, clock: "01:00" }),
      line({ issue: 15, clock: "02:00", from: "READY", to: "BLOCKED", reason: "stuck" }),
    ]);
    expect(run?.blockedAtSelection).toBe(0);
    expect(summary(run)).toEqual(["15:1:blocked"]);
  });

  it("makes no bar and no build for a parent issue", () => {
    const [run] = runs(
      [
        line({ issue: 5, clock: "01:00" }),
        line({ issue: 6, clock: "01:00" }),
        line({ issue: 5, clock: "02:00", from: "READY", to: "BLOCKED", reason: "x" }),
      ],
      { parents: ["r-acme#5"] },
    );
    expect(run?.builds.map((b) => b.issue)).toEqual([6]);
    expect(run?.blockedAtSelection).toBe(0);
  });

  it("ends an open build at now while the lock holds the run", () => {
    const [run] = runs(
      [
        line({ issue: 1, clock: "10:00", day: "2026-11-15" }),
        line({ issue: 2, clock: "10:10", day: "2026-11-15" }),
      ],
      { lockRunId: "run-1" },
    );
    expect(run?.running).toBe(true);
    expect(run?.end).toEqual(NOW);
    expect(run?.builds.map((b) => [b.result, b.end])).toEqual([
      ["running", NOW],
      ["running", NOW],
    ]);
  });

  it("takes the run of the newest line, and the newest first", () => {
    const result = runs([
      line({ runId: "old", clock: "01:00" }),
      line({ runId: "new", clock: "02:00", day: "2026-11-15", issue: 2 }),
    ]);
    expect(result.map((run) => run.runId)).toEqual(["new", "old"]);
  });

  it("uses the older run of a client, with lanes of that client only", () => {
    const acmeLines = [
      line({ runId: "old", issue: 1, clock: "01:00" }),
      line({ runId: "old", issue: 2, clock: "01:05", repo: "/s/globex/portal" }),
      line({ runId: "old", issue: 3, clock: "01:10" }),
      line({
        runId: "old",
        issue: 1,
        clock: "02:00",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #1",
      }),
    ];
    const newer = line({
      runId: "new",
      issue: 9,
      clock: "01:00",
      day: "2026-11-15",
      repo: "/s/globex/portal",
    });
    const [run, ...rest] = runs([...acmeLines, newer], {
      scope: { kind: "client", client: "acme" },
    });
    expect(rest).toEqual([]);
    expect(run?.runId).toBe("old");
    expect([run?.start, run?.end]).toEqual([at("01:00"), at("02:00")]);
    expect(summary(run)).toEqual(["1:1:merged", "3:2:stopped at run end"]);
  });

  it("ignores a repo folder that is not in the list in a client scope, and labels it in All", () => {
    const entries = [line({ issue: 7, clock: "01:00", repo: "/elsewhere/tools/spike-cli" })];
    expect(runs(entries, { scope: { kind: "client", client: "acme" } })).toEqual([]);
    const [run] = runs(entries);
    expect(run?.builds[0]?.repo).toMatchObject({ id: null, label: "spike-cli" });
  });

  it("gives each run of the window its own builds, lanes, skips and peak", () => {
    const result = runs([
      line({ runId: "a", issue: 1, clock: "01:00" }),
      line({ runId: "a", issue: 2, clock: "01:10" }),
      line({ runId: "a", issue: 3, clock: "01:20" }),
      line({
        runId: "a",
        issue: 1,
        clock: "02:00",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #1",
      }),
      line({
        runId: "a",
        issue: 2,
        clock: "02:30",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #2",
      }),
      line({
        runId: "a",
        issue: 3,
        clock: "02:40",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #3",
      }),
      line({ runId: "a", issue: 9, clock: "02:50", from: "READY", to: "READY", reason: "skipped" }),
      line({ runId: "b", issue: 4, clock: "01:00", day: "2026-11-15" }),
      line({
        runId: "b",
        issue: 4,
        clock: "02:00",
        day: "2026-11-15",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #4",
      }),
      line({
        runId: "b",
        issue: 5,
        clock: "02:10",
        day: "2026-11-15",
        from: "READY",
        to: "BLOCKED",
        reason: "blocked",
      }),
    ]);
    expect(result.map((run) => run.runId)).toEqual(["b", "a"]);
    const [newer, older] = result;
    expect([older?.builds.length, older?.lanes, older?.peak, older?.skips]).toEqual([3, 3, 3, 1]);
    expect([newer?.builds.length, newer?.lanes, newer?.peak, newer?.blockedAtSelection]).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("gives a peak of builds at one time, and counts a build that starts when another ends once", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({ issue: 2, clock: "01:10" }),
      line({ issue: 1, clock: "02:00", from: "IN PROGRESS", to: "DONE", reason: "merged #1" }),
      line({ issue: 3, clock: "02:00" }),
      line({ issue: 2, clock: "03:00", from: "IN PROGRESS", to: "DONE", reason: "merged #2" }),
      line({ issue: 3, clock: "03:30", from: "IN PROGRESS", to: "DONE", reason: "merged #3" }),
    ]);
    expect(run?.peak).toBe(2);
  });

  it("has a peak of 0 for a run with no build", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00", from: "READY", to: "READY", reason: "skipped" }),
    ]);
    expect(run?.peak).toBe(0);
  });

  it("counts only the builds of the client in the peak of a client scope", () => {
    const [run] = runs(
      [
        line({ issue: 1, clock: "01:00" }),
        line({ issue: 2, clock: "01:05", repo: "/s/globex/portal" }),
        line({ issue: 3, clock: "01:10", repo: "/s/globex/portal" }),
        line({ issue: 4, clock: "01:15" }),
        line({ issue: 1, clock: "02:00", from: "IN PROGRESS", to: "DONE", reason: "merged #1" }),
        line({ issue: 4, clock: "02:10", from: "IN PROGRESS", to: "DONE", reason: "merged #4" }),
      ],
      { scope: { kind: "client", client: "acme" } },
    );
    expect(run?.peak).toBe(2);
  });

  it("makes no build for a Spec issue that settles with every child issue DONE", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({
        issue: 24,
        clock: "01:30",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "every child issue is DONE",
      }),
      line({ issue: 1, clock: "02:00", from: "IN REVIEW", to: "DONE", reason: "merged #40" }),
    ]);
    expect(run?.builds.map((build) => build.issue)).toEqual([1]);
    expect(run?.skips).toBe(0);
  });

  it("marks the end of the build stage with an opened line", () => {
    const [run] = runs([
      line({ issue: 1, clock: "01:00" }),
      line({ issue: 2, clock: "01:00" }),
      line({ issue: 3, clock: "01:00" }),
      line({
        issue: 1,
        clock: "01:40",
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "opened #59",
      }),
      line({
        issue: 2,
        clock: "01:50",
        from: "IN PROGRESS",
        to: "IN REVIEW",
        reason: "PR #21 opened",
      }),
    ]);
    const opened = Object.fromEntries(
      (run?.builds ?? []).map((build) => [build.issue, build.prOpenedAt?.toISOString() ?? null]),
    );
    expect(opened).toEqual({
      1: "2026-11-14T01:40:00.000Z",
      2: "2026-11-14T01:50:00.000Z",
      3: null,
    });
  });

  it("returns no run for no line", () => {
    expect(runs([])).toEqual([]);
  });
});
