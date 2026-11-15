import type { ControlEvent } from "../dash/control-events.ts";

export const TIERS = ["authority", "sensitive", "general", "inert"] as const;
export type Tier = (typeof TIERS)[number];

export type GateEvent = Extract<ControlEvent, { kind: "gate" }>;
type EscalatedEvent = Extract<ControlEvent, { kind: "escalated" }>;

/** A tier of the Risk map, or null for a tier that is not one of the four. */
export function asTier(value: string | null): Tier | null {
  return TIERS.find((tier) => tier === value) ?? null;
}

/** The highest tier first: `authority` is 0, `inert` is 3. */
const rank = (tier: Tier): number => TIERS.indexOf(tier);

export type SettleEvent = GateEvent & { decision: "pass" | "blocked" };

export interface PullRequestRecord {
  repo: string;
  pr: number;
  /** The highest tier of all its `gate` and `escalated` events, or null for no tier. */
  finalTier: Tier | null;
  /** The `path_tier` of its first `escalated` event, or the final tier when it has none. */
  pathTier: Tier | null;
  /** The pull request has one or more `escalated` events. */
  escalated: boolean;
  /** The highest `round` of its `gate` events, wait events included. */
  rounds: number;
  /** The first `gate` event of round 1 whose decision is `pass` or `fail`. */
  roundOneEvent: GateEvent | null;
  /** The last decision event (`pass`, `fail` or `blocked`). A `wait` event is never one. */
  lastDecisionEvent: GateEvent | null;
  /** The last decision event, when its decision is `pass` or `blocked`. Otherwise the pull request is not settled. */
  settleEvent: SettleEvent | null;
}

const isGate = (event: ControlEvent): event is GateEvent => event.kind === "gate";
const isEscalated = (event: ControlEvent): event is EscalatedEvent => event.kind === "escalated";
const isDecision = (event: GateEvent): boolean => event.decision !== "wait";
const isSettle = (event: GateEvent): event is SettleEvent =>
  event.decision === "pass" || event.decision === "blocked";

function highestTier(tiers: readonly (Tier | null)[]): Tier | null {
  let best: Tier | null = null;
  for (const tier of tiers) {
    if (tier !== null && (best === null || rank(tier) < rank(best))) best = tier;
  }
  return best;
}

/**
 * The pull requests of the Control events, by repo and pull request number. A pull request has a
 * record when it has a `gate` event in the window: an `escalated` event alone makes no record. The
 * caller passes the events of one scope. The events come oldest first, as `readControlEvents`
 * returns them; the records come in the order of each pull request's first `gate` event.
 */
export function pullRequestRecords(events: readonly ControlEvent[]): PullRequestRecord[] {
  const byPr = new Map<string, { repo: string; pr: number; events: ControlEvent[] }>();
  for (const event of events) {
    if (event.kind !== "gate" && event.kind !== "escalated") continue;
    const key = `${event.repo}\u0000${event.pr.toString()}`;
    const entry = byPr.get(key) ?? { repo: event.repo, pr: event.pr, events: [] };
    entry.events.push(event);
    byPr.set(key, entry);
  }

  const records: PullRequestRecord[] = [];
  for (const { repo, pr, events: prEvents } of byPr.values()) {
    const gates = prEvents.filter(isGate);
    if (gates.length === 0) continue;
    const escalations = prEvents.filter(isEscalated);
    const finalTier = highestTier(
      prEvents.map((event) =>
        asTier(event.kind === "gate" || event.kind === "escalated" ? event.tier : null),
      ),
    );
    const decisions = gates.filter(isDecision);
    const lastDecisionEvent = decisions[decisions.length - 1] ?? null;
    records.push({
      repo,
      pr,
      finalTier,
      pathTier: escalations.length > 0 ? asTier(escalations[0]?.path_tier ?? null) : finalTier,
      escalated: escalations.length > 0,
      rounds: gates.reduce((most, event) => Math.max(most, event.round), 0),
      roundOneEvent:
        gates.find(
          (event) => event.round === 1 && isDecision(event) && event.decision !== "blocked",
        ) ?? null,
      lastDecisionEvent,
      settleEvent:
        lastDecisionEvent !== null && isSettle(lastDecisionEvent) ? lastDecisionEvent : null,
    });
  }
  return records;
}

/** The pull requests whose round 1 event has no `matrix`: the findings views do not count them. */
export function withoutMatrix(records: readonly PullRequestRecord[]): number {
  return records.filter(
    (record) => record.roundOneEvent !== null && record.roundOneEvent.matrix === undefined,
  ).length;
}
