import { describe, expect, it } from "vitest";
import type { ControlEvent } from "../dash/control-events.ts";
import { buildGateSignals, pullKey } from "./gate-signals.ts";

type GateEvent = Extract<ControlEvent, { kind: "gate" }>;

function gate(over: Partial<GateEvent>): ControlEvent {
  const time = over.time ?? "2026-11-15T10:00:00Z";
  return {
    kind: "gate",
    repo: "acme/app",
    time,
    at: new Date(time),
    pr: 40,
    issue: null,
    tier: null,
    round: 1,
    decision: "pass",
    counts: {},
    categories: [],
    refs: [],
    waived: [],
    ...over,
  } satisfies GateEvent;
}

describe("buildGateSignals", () => {
  it("takes the highest round and the newest decision of a pull request", () => {
    const signals = buildGateSignals([
      gate({ round: 3, decision: "blocked", time: "2026-11-15T10:00:00Z" }),
      gate({ round: 1, decision: "pass", time: "2026-11-14T10:00:00Z" }),
      gate({ round: 2, decision: "fail", time: "2026-11-14T12:00:00Z" }),
    ]);
    expect(signals.byPull.get(pullKey("acme/app", 40))).toEqual({
      round: 3,
      decision: "blocked",
    });
  });

  it("keeps pull requests of two repos apart and matches the repo in lower case", () => {
    const signals = buildGateSignals([
      gate({ repo: "Acme/App", round: 1 }),
      gate({ repo: "acme/web", round: 2 }),
    ]);
    expect(signals.byPull.get(pullKey("acme/app", 40))?.round).toBe(1);
    expect(signals.byPull.get(pullKey("acme/web", 40))?.round).toBe(2);
    expect([...signals.reposWithEvents].sort()).toEqual(["acme/app", "acme/web"]);
  });

  it("counts an event of another kind as an event of the repo, with no gate signal", () => {
    const merged = {
      kind: "merged",
      repo: "acme/web",
      time: "2026-11-15T10:00:00Z",
      at: new Date("2026-11-15T10:00:00Z"),
      pr: 9,
      issue: null,
      base: "main",
      tier: null,
    } satisfies ControlEvent;
    const signals = buildGateSignals([merged]);
    expect(signals.reposWithEvents.has("acme/web")).toBe(true);
    expect(signals.byPull.size).toBe(0);
  });
});
