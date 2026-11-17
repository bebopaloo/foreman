import { describe, expect, it } from "vitest";
import {
  backgroundAgent,
  makeFactoryDir,
  minutesAgo,
  nightLine,
  NOW,
  isoSeconds,
  transcriptAssistant,
  transcriptUser,
  writeJsonl,
  writeLock,
  writeSummary,
  writeTranscript,
} from "../../test/dash-fixtures.ts";
import { readNightLog, readRunLock } from "./night-log.ts";
import { readRunStatus, STALL_AFTER_SECONDS } from "./run-status.ts";

const TODAY = "2026-11-15";

async function statusOf(setup: (dirs: { claudeDir: string; factory: string }) => Promise<void>) {
  const dirs = await makeFactoryDir();
  await setup(dirs);
  const [log, lock] = await Promise.all([
    readNightLog(dirs.claudeDir, NOW),
    readRunLock(dirs.claudeDir, NOW),
  ]);
  return readRunStatus(dirs.claudeDir, lock, log.entries, NOW);
}

const lockAt = (minutes: number, runId = "run-1") => ({
  run_id: runId,
  heartbeat: minutesAgo(minutes).getTime() / 1000,
});
const lineAt = (minutes: number, over: Record<string, unknown> = {}) =>
  nightLine({ time: isoSeconds(minutesAgo(minutes)), ...over });

describe("run status", () => {
  it("makes the threshold 20 minutes", () => {
    expect(STALL_AFTER_SECONDS).toBe(1200);
  });

  it("is running when the lock is fresh", async () => {
    const status = await statusOf(async ({ factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(4));
    });
    expect(status).toMatchObject({ state: "running", runId: "run-1", stalledBy: null });
    expect(status.quietSeconds).toBe(240);
    expect(status.heartbeatAt).toBe(minutesAgo(4).toISOString());
  });

  it("is stalled when heartbeat, last line and loop transcript are 21 minutes old", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(60), lineAt(21)]);
      await writeLock(factory, lockAt(21));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(21),
        lines: [transcriptUser(minutesAgo(90)), transcriptAssistant(minutesAgo(21), "tool_use")],
      });
    });
    expect(status).toMatchObject({ state: "stalled", stalledBy: "quiet" });
    expect(status.quietSeconds).toBe(21 * 60);
    expect(status.loopActivityAt).toBe(minutesAgo(21).toISOString());
  });

  it("is running when only the loop transcript moved in the last 20 minutes", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(60)]);
      await writeLock(factory, lockAt(45));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(2),
        lines: [transcriptUser(minutesAgo(90)), transcriptAssistant(minutesAgo(2), "tool_use")],
      });
    });
    expect(status.state).toBe("running");
  });

  it("is stalled at once when the loop transcript ends its turn and no agent runs", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(1),
        lines: [transcriptUser(minutesAgo(90)), transcriptAssistant(minutesAgo(1), "end_turn")],
      });
    });
    expect(status).toMatchObject({ state: "stalled", stalledBy: "end-turn", agentsInFlight: 0 });
    expect(status.loopEndedTurnAt).toBe(minutesAgo(1).toISOString());
  });

  it("is running when the turn ended but a background agent is in flight", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(1),
        lines: [
          transcriptUser(minutesAgo(90)),
          transcriptAssistant(minutesAgo(5), "tool_use", [backgroundAgent()]),
          transcriptAssistant(minutesAgo(1), "end_turn"),
        ],
      });
    });
    expect(status).toMatchObject({ state: "running", agentsInFlight: 1 });
  });

  it("does not count an agent that a task notification followed", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(1),
        lines: [
          transcriptUser(minutesAgo(90)),
          transcriptAssistant(minutesAgo(8), "tool_use", [backgroundAgent()]),
          transcriptUser(minutesAgo(5), "<task-notification>done</task-notification>"),
          transcriptAssistant(minutesAgo(1), "end_turn"),
        ],
      });
    });
    expect(status).toMatchObject({ state: "stalled", stalledBy: "end-turn", agentsInFlight: 0 });
  });

  it("is running when a user message follows the end of the turn", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(1),
        lines: [
          transcriptUser(minutesAgo(90)),
          transcriptAssistant(minutesAgo(5), "end_turn"),
          transcriptUser(minutesAgo(1), "go on"),
        ],
      });
    });
    expect(status.state).toBe("running");
  });

  it("ignores a transcript with no loop marker, a transcript older than the run, and one that ended before the run", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      await writeTranscript(claudeDir, {
        name: "chat",
        mtime: minutesAgo(1),
        lines: [
          transcriptUser(minutesAgo(90), "hello"),
          transcriptAssistant(minutesAgo(1), "end_turn"),
        ],
      });
      await writeTranscript(claudeDir, {
        name: "old",
        mtime: minutesAgo(600),
        lines: [transcriptUser(minutesAgo(700)), transcriptAssistant(minutesAgo(600), "end_turn")],
      });
    });
    expect(status).toMatchObject({ state: "running", loopActivityAt: null, agentsInFlight: null });
  });

  it("reads only the tail of a large transcript", async () => {
    const status = await statusOf(async ({ claudeDir, factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(30)]);
      await writeLock(factory, lockAt(1));
      const filler = Array.from({ length: 3000 }, () =>
        transcriptAssistant(minutesAgo(80), "tool_use", [{ type: "text", text: "x".repeat(300) }]),
      );
      await writeTranscript(claudeDir, {
        name: "loop",
        mtime: minutesAgo(1),
        lines: [
          transcriptUser(minutesAgo(90)),
          transcriptAssistant(minutesAgo(85), "tool_use", [backgroundAgent()]),
          ...filler,
          transcriptAssistant(minutesAgo(1), "end_turn"),
        ],
      });
    });
    // The agent launch is before the tail window, so it is not counted.
    expect(status).toMatchObject({ state: "stalled", stalledBy: "end-turn", agentsInFlight: 0 });
  });

  it("is ended with a summary and ended-without-summary without one", async () => {
    const withSummary = await statusOf(async ({ factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(300)]);
      await writeSummary(factory, TODAY, "run-1");
    });
    expect(withSummary).toMatchObject({ state: "ended", runId: "run-1", hasSummary: true });
    const without = await statusOf(async ({ factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(300)]);
    });
    expect(without).toMatchObject({
      state: "ended-without-summary",
      runId: "run-1",
      hasSummary: false,
    });
  });

  it("is ended when the lock is stale", async () => {
    const status = await statusOf(async ({ factory }) => {
      await writeJsonl(factory, "runs", TODAY, [lineAt(400)]);
      await writeLock(factory, lockAt(240));
    });
    expect(status).toMatchObject({ state: "ended-without-summary", lockStale: true });
  });

  it("is none with no lock and no night log, and unreadable with a bad lock", async () => {
    expect((await statusOf(() => Promise.resolve())).state).toBe("none");
    const bad = await statusOf(async ({ factory }) => {
      await writeLock(factory, "{bad");
    });
    expect(bad.state).toBe("unreadable");
  });
});
