import { describe, expect, it } from "vitest";
import {
  gateEvent,
  isoSeconds,
  makeFactoryDir,
  minutesAgo,
  NOW,
  writeJsonl,
} from "../../test/dash-fixtures.ts";
import { readControlEvents } from "./control-events.ts";

const TODAY = "2026-11-15";
const time = isoSeconds(minutesAgo(10));

describe("readControlEvents", () => {
  it("reads each kind of event", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "controls", TODAY, [
      gateEvent({ matrix: { Security: { major: 1 } } }),
      {
        kind: "escalated",
        repo: "acme/app",
        time,
        pr: 40,
        issue: null,
        path_tier: "general",
        tier: "sensitive",
        paths: ["a"],
        evidence: "x",
      },
      { kind: "waiver_used", repo: "acme/app", time, pr: 40, waiver: "W-1", finding: "f" },
      { kind: "merged", repo: "acme/app", time, pr: 40, issue: 12, base: "main", tier: null },
      { kind: "finding_overdue", repo: "acme/app", time, issue: 12, due: null, source: null },
    ]);
    const read = await readControlEvents(claudeDir, NOW);
    expect(read.events.map((event) => event.kind).sort()).toEqual([
      "escalated",
      "finding_overdue",
      "gate",
      "merged",
      "waiver_used",
    ]);
    expect(read.skippedLines).toBe(0);
  });

  it("skips and counts an event of an unknown kind or with an unknown key", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "controls", TODAY, [
      gateEvent(),
      { kind: "surprise", repo: "acme/app", time },
      gateEvent({ extra: true }),
      gateEvent({ round: 4 }),
      gateEvent({ decision: "maybe" }),
    ]);
    const read = await readControlEvents(claudeDir, NOW);
    expect(read.events).toHaveLength(1);
    expect(read.skippedLines).toBe(4);
    expect(read.reports).toEqual([{ file: `${TODAY}.jsonl`, lines: 4 }]);
  });

  it("counts a time in the future as now", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "controls", TODAY, [
      gateEvent({ time: isoSeconds(new Date(NOW.getTime() + 120_000)) }),
    ]);
    const read = await readControlEvents(claudeDir, NOW);
    expect(read.events[0]?.at).toEqual(NOW);
  });

  it("gives no data for a missing folder", async () => {
    const { claudeDir } = await makeFactoryDir();
    expect(await readControlEvents(claudeDir, NOW)).toMatchObject({
      folder: "missing",
      events: [],
    });
  });
});
