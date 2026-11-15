import type { ControlEvent } from "../src/dash/control-events.ts";

let tick = 0;
function when(): Date {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 14, 1, tick));
}

type GateOver = Partial<Extract<ControlEvent, { kind: "gate" }>>;

export function gate(over: GateOver & { pr: number }): ControlEvent {
  const at = when();
  return {
    kind: "gate",
    repo: "acme/app",
    time: at.toISOString(),
    issue: null,
    tier: null,
    round: 1,
    decision: "pass",
    counts: {},
    categories: {},
    refs: [],
    waived: [],
    at,
    ...over,
  };
}

export function escalated(over: {
  pr: number;
  path_tier: string | null;
  tier: string | null;
  repo?: string;
}): ControlEvent {
  const at = when();
  return {
    kind: "escalated",
    repo: "acme/app",
    time: at.toISOString(),
    issue: null,
    paths: [],
    evidence: "x",
    at,
    ...over,
  };
}

export function merged(over: { base: string; tier: string | null; pr?: number }): ControlEvent {
  const at = when();
  return {
    kind: "merged",
    repo: "acme/app",
    time: at.toISOString(),
    pr: 1,
    issue: null,
    at,
    ...over,
  };
}
