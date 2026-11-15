import type { ControlEvent } from "../dash/control-events.ts";

export type GateDecision = "pass" | "fail" | "wait" | "blocked";

export interface GateSignal {
  /** The highest round of the `gate` events of the pull request. */
  round: number;
  /** The decision of the newest `gate` event. */
  decision: GateDecision;
}

export interface GateSignals {
  byPull: ReadonlyMap<string, GateSignal>;
  /** The repos (`owner/name` in lower case) with one or more Control events of any kind. */
  reposWithEvents: ReadonlySet<string>;
}

export function pullKey(fullName: string, pull: number): string {
  return `${fullName.toLowerCase()}#${pull.toString()}`;
}

/**
 * The round and the decision of each pull request, from the Control events that the reader gave
 * (the last 30 days). Of two `gate` events with the same time, the later one in the list wins.
 */
export function buildGateSignals(events: readonly ControlEvent[]): GateSignals {
  const newest = new Map<string, { at: number; decision: GateDecision }>();
  const rounds = new Map<string, number>();
  const reposWithEvents = new Set<string>();
  for (const event of events) {
    reposWithEvents.add(event.repo.toLowerCase());
    if (event.kind !== "gate") continue;
    const key = pullKey(event.repo, event.pr);
    const at = event.at.getTime();
    const before = newest.get(key);
    if (before === undefined || at >= before.at) newest.set(key, { at, decision: event.decision });
    rounds.set(key, Math.max(rounds.get(key) ?? 0, event.round));
  }
  const byPull = new Map<string, GateSignal>();
  for (const [key, { decision }] of newest) {
    byPull.set(key, { round: rounds.get(key) ?? 1, decision });
  }
  return { byPull, reposWithEvents };
}
