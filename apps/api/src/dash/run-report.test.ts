import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gateEvent, makeFactoryDir, NOW, nightLine, writeJsonl } from "../../test/dash-fixtures.ts";
import { buildRunReport, readRunReport, repoKey, type ReportEntry } from "./run-report.ts";
import type { ControlEvent } from "./control-events.ts";

const at = (clock: string): Date => new Date(`2026-11-14T${clock}:00Z`);
const APP = "/s/acme/app";

function entry(clock: string, over: Partial<ReportEntry> = {}): ReportEntry {
  return {
    repo: APP,
    issue: 1,
    from: "READY",
    to: "IN PROGRESS",
    reason: "build started",
    time: at(clock),
    pr: null,
    ...over,
  };
}

function report(entries: ReportEntry[], events: ControlEvent[] = []) {
  return buildRunReport({ runId: "run-1", entries, events, summary: null, skippedLines: 0 });
}

function control(over: Record<string, unknown>): ControlEvent {
  return { at: at("22:00"), ...over } as unknown as ControlEvent;
}

describe("repoKey", () => {
  it("joins a folder, a bare name and owner/name", () => {
    expect(repoKey("/Users/t/Bebopaloo/Foreman/")).toBe("foreman");
    expect(repoKey("foreman")).toBe("foreman");
    expect(repoKey("bebopaloo/foreman")).toBe("foreman");
  });
});

describe("buildRunReport", () => {
  it("lists the state changes without the skips", () => {
    const result = report([
      entry("22:00", { issue: 9, from: "READY", to: "READY", reason: "blocked by #8" }),
      entry("22:01"),
      entry("22:10", { from: "IN PROGRESS", to: "DONE", reason: "merged #5" }),
    ]);
    expect(result.stateChanges.map((change) => change.to)).toEqual(["IN PROGRESS", "DONE"]);
  });

  it("matches a merge to its events by repo and pull request", () => {
    const result = report(
      [
        entry("22:00"),
        entry("22:10", { from: "IN REVIEW", to: "DONE", reason: "merged #5", repo: "app" }),
      ],
      [
        control({
          kind: "gate",
          repo: "acme/app",
          pr: 5,
          tier: "general",
          round: 1,
          decision: "fail",
          counts: { major: 1 },
        }),
        control({
          kind: "gate",
          repo: "acme/app",
          pr: 5,
          tier: "general",
          round: 2,
          decision: "pass",
          counts: { minor: 2 },
        }),
        control({ kind: "merged", repo: "acme/app", pr: 5, tier: "sensitive" }),
        control({
          kind: "gate",
          repo: "acme/other",
          pr: 5,
          tier: "general",
          round: 3,
          decision: "pass",
          counts: { info: 9 },
        }),
      ],
    );
    expect(result.merges).toEqual([
      expect.objectContaining({
        issue: 1,
        pr: 5,
        tier: "sensitive",
        round: 2,
        counts: { minor: 2 },
      }),
    ]);
  });

  it("shows a merge with no control event with a null tier", () => {
    const result = report([entry("22:10", { to: "DONE", reason: "merged #7" })]);
    expect(result.merges[0]).toMatchObject({ pr: 7, tier: null, round: null, counts: {} });
  });

  it("lists the BLOCKED items with their reasons", () => {
    const result = report([
      entry("22:00"),
      entry("22:05", { to: "BLOCKED", reason: "CI fails on #9" }),
    ]);
    expect(result.blocked).toEqual([
      expect.objectContaining({ issue: 1, reason: "CI fails on #9" }),
    ]);
  });

  it("groups the skips by blocker and keeps the other skips", () => {
    const skip = (issue: number, reason: string) => entry("22:00", { issue, to: "READY", reason });
    const result = report([
      skip(5, "blocked by #2, #3"),
      skip(4, "blocked by #2"),
      skip(6, "waiting: build limit of 5 reached"),
    ]);
    expect(result.skips.total).toBe(3);
    expect(result.skips.byBlocker).toEqual([
      { repo: APP, blocker: 2, issues: [4, 5] },
      { repo: APP, blocker: 3, issues: [5] },
    ]);
    expect(result.skips.other).toEqual([
      { repo: APP, issue: 6, reason: "waiting: build limit of 5 reached" },
    ]);
  });

  it("measures the slot use per minute from the first build", () => {
    const result = report([
      entry("22:00", { issue: 9, to: "READY", reason: "blocked by #1" }),
      entry("22:10", { issue: 1 }),
      entry("22:11", { issue: 2 }),
      entry("22:13", { issue: 1, from: "IN PROGRESS", to: "DONE", reason: "merged #5" }),
      entry("22:14", { issue: 2, from: "IN PROGRESS", to: "IN REVIEW", reason: "merge-ready #6" }),
      entry("22:15", { issue: 3, from: "READY", to: "DONE", reason: "every child issue is DONE" }),
    ]);
    // Minutes 22:10 to 22:14: busy 1, 2, 2, 1, 0.
    expect(result.slotUse.perMinute).toEqual([1, 2, 2, 1, 0]);
    expect(result.slotUse.minutes).toBe(5);
    expect(result.slotUse.average).toBe(1.2);
    expect(result.slotUse.minutesAtCount).toEqual([1, 2, 2, 0, 0, 0]);
    expect(result.slotUse.builds).toBe(2);
  });

  it("does not count a Spec issue that settles with all children DONE", () => {
    const result = report([
      entry("22:00", { issue: 3 }),
      entry("22:05", {
        issue: 3,
        from: "IN PROGRESS",
        to: "DONE",
        reason: "every child issue is DONE",
      }),
    ]);
    expect(result.slotUse.builds).toBe(0);
  });

  it("runs a build with no end to the end of the run", () => {
    const result = report([
      entry("22:00"),
      entry("22:03", { issue: 2, to: "BLOCKED", from: "READY", reason: "x" }),
    ]);
    expect(result.slotUse.perMinute).toEqual([1, 1, 1]);
  });
});

describe("readRunReport", () => {
  it("reads the lines of one run, a pr key and the summary file", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", "2026-11-14", [
      nightLine({ run_id: "run-a", time: "2026-11-14T22:00:00Z" }),
      nightLine({ run_id: "run-b", issue: 2, time: "2026-11-14T22:00:00Z" }),
      nightLine({
        run_id: "run-a",
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #4",
        pr: 4,
        time: "2026-11-14T22:05:00Z",
      }),
      "not json",
    ]);
    await mkdir(path.join(factory, "runs"), { recursive: true });
    await writeFile(path.join(factory, "runs", "2026-11-14-run-a.md"), "# Summary <b>x</b>\n");
    await writeJsonl(factory, "controls", "2026-11-14", [
      gateEvent({ repo: "acme/app", pr: 4, time: "2026-11-14T22:04:00Z", counts: { minor: 1 } }),
    ]);
    const result = await readRunReport(claudeDir, "run-a", NOW);
    expect(result?.stateChanges).toHaveLength(2);
    expect(result?.merges[0]).toMatchObject({ pr: 4, tier: "general", counts: { minor: 1 } });
    expect(result?.summary).toEqual({ file: "2026-11-14-run-a.md", text: "# Summary <b>x</b>\n" });
    expect(result?.skippedLines).toBe(1);
  });

  it("returns null for an unknown run", async () => {
    const { claudeDir } = await makeFactoryDir();
    expect(await readRunReport(claudeDir, "run-none", NOW)).toBeNull();
  });
});
