import { chmod, mkdir, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  makeFactoryDir,
  minutesAgo,
  nightLine,
  NOW,
  isoSeconds,
  writeJsonl,
  writeLock,
} from "../../test/dash-fixtures.ts";
import { readNightLog, readRunLock } from "./night-log.ts";

const TODAY = "2026-11-15";

describe("readNightLog", () => {
  it("uses all valid lines and counts one line that is not valid JSON", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [nightLine({ issue: 1 }), "{not json", nightLine()]);
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries.map((entry) => entry.issue).sort()).toEqual([1, 12]);
    expect(read.skippedLines).toBe(1);
    expect(read.reports).toEqual([{ file: `${TODAY}.jsonl`, lines: 1 }]);
  });

  it("ignores a last line with no line end and does not count it", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [nightLine({ issue: 1 }), '{"run_id":"run-1","re'], {
      lineEnd: false,
    });
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries.map((entry) => entry.issue)).toEqual([1]);
    expect(read.skippedLines).toBe(0);
  });

  it("ignores a last valid line that has no line end", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [nightLine({ issue: 1 }), nightLine({ issue: 2 })], {
      lineEnd: false,
    });
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries.map((entry) => entry.issue)).toEqual([1]);
  });

  it("skips a line with an unknown key, a bad state or a bad time", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [
      nightLine({ extra: 1 }),
      nightLine({ to: "DOING" }),
      nightLine({ time: "2026-11-15 10:00:00" }),
      nightLine({ time: "2026-13-45T10:00:00Z" }),
      nightLine({ issue: 0 }),
      nightLine({ reason: "x".repeat(501) }),
    ]);
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries).toHaveLength(0);
    expect(read.skippedLines).toBe(6);
  });

  it("reads the files of the last 31 days and the lines of the last 30 days", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    const old = isoSeconds(new Date(NOW.getTime() - 30 * 24 * 3600_000 - 60_000));
    const recent = isoSeconds(new Date(NOW.getTime() - 29 * 24 * 3600_000));
    await writeJsonl(factory, "runs", "2026-10-15", [
      nightLine({ issue: 1, time: old }),
      nightLine({ issue: 2, time: recent }),
    ]);
    await writeJsonl(factory, "runs", "2026-10-14", [nightLine({ issue: 3 }), "{bad"]);
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries.map((entry) => entry.issue)).toEqual([2]);
    // A file outside the 31 days is not read, so its bad line does not count.
    expect(read.skippedLines).toBe(0);
  });

  it("counts a time in the future as now", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [
      nightLine({ time: isoSeconds(new Date(NOW.getTime() + 120_000)) }),
    ]);
    const read = await readNightLog(claudeDir, NOW);
    expect(read.entries[0]?.time).toEqual(NOW);
  });

  it("gives no data for a missing folder", async () => {
    const { claudeDir } = await makeFactoryDir();
    const read = await readNightLog(claudeDir, NOW);
    expect(read).toMatchObject({ folder: "missing", entries: [], skippedLines: 0 });
  });

  it("reports a folder that it cannot read", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [nightLine()]);
    await chmod(path.join(factory, "runs"), 0o000);
    try {
      const read = await readNightLog(claudeDir, NOW);
      expect(read.folder).toBe("unreadable");
      expect(read.entries).toHaveLength(0);
    } finally {
      await chmod(path.join(factory, "runs"), 0o755);
    }
  });

  it("skips and counts a file larger than 50 MB", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await mkdir(path.join(factory, "runs"));
    const big = path.join(factory, "runs", `${TODAY}.jsonl`);
    await writeFile(big, "");
    await truncate(big, 50 * 1024 * 1024 + 1);
    const read = await readNightLog(claudeDir, NOW);
    expect(read.skippedFiles).toBe(1);
    expect(read.entries).toHaveLength(0);
  });
});

describe("readRunLock", () => {
  const at = (minutes: number) => minutesAgo(minutes).getTime() / 1000;

  it("reports no lock when the file is missing", async () => {
    const { claudeDir } = await makeFactoryDir();
    expect(await readRunLock(claudeDir, NOW)).toEqual({ state: "none" });
  });

  it("reads a fresh lock with a heartbeat of whole or part seconds", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, { run_id: "run-1", heartbeat: at(4) + 0.5 });
    const lock = await readRunLock(claudeDir, NOW);
    expect(lock).toMatchObject({ state: "held", runId: "run-1", stale: false, ageSeconds: 239 });
  });

  it("marks a heartbeat more than 10,800 seconds ago as stale, and only then", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, { run_id: "run-1", heartbeat: NOW.getTime() / 1000 - 10_800 });
    expect(await readRunLock(claudeDir, NOW)).toMatchObject({ stale: false });
    await writeLock(factory, { run_id: "run-1", heartbeat: NOW.getTime() / 1000 - 10_801 });
    expect(await readRunLock(claudeDir, NOW)).toMatchObject({ stale: true });
  });

  it("counts a heartbeat in the future as now", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, { run_id: "run-1", heartbeat: NOW.getTime() / 1000 + 120 });
    const lock = await readRunLock(claudeDir, NOW);
    expect(lock).toMatchObject({ state: "held", ageSeconds: 0, stale: false });
    expect(lock.state === "held" && lock.heartbeatAt).toEqual(NOW);
  });

  it("reads the lock once more after a short wait when it is not valid", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, '{"run_id": "run-1", "heart');
    setTimeout(() => {
      void writeLock(factory, { run_id: "run-1", heartbeat: at(1) });
    }, 30);
    const lock = await readRunLock(claudeDir, NOW, 100);
    expect(lock.state).toBe("held");
  });

  it("is unreadable when the lock is not valid on both reads", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, "{nope");
    const started = Date.now();
    expect(await readRunLock(claudeDir, NOW)).toEqual({ state: "unreadable" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });

  it("is unreadable when the lock has the wrong shape", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeLock(factory, { run_id: "run-1", heartbeat: "soon" });
    expect(await readRunLock(claudeDir, NOW, 1)).toEqual({ state: "unreadable" });
  });
});
