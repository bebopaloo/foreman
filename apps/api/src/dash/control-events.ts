import path from "node:path";
import { z } from "zod";
import { LINE_TIME } from "./night-log.ts";
import { parseLineTime, readJsonlWindow, type WindowRead } from "./jsonl-window.ts";

const base = {
  repo: z.string().min(1),
  time: z.string().regex(LINE_TIME),
};
const pr = z.number().int().positive();
const issue = z.number().int().positive();
const tier = z.string().min(1).max(40);

const GateEvent = z
  .object({
    kind: z.literal("gate"),
    ...base,
    pr,
    issue: issue.nullable(),
    tier: tier.nullable(),
    round: z.number().int().min(1).max(3),
    decision: z.enum(["pass", "fail", "wait", "blocked"]),
    counts: z.json(),
    categories: z.json(),
    refs: z.json(),
    waived: z.json(),
    matrix: z.json().optional(),
  })
  .strict();

const EscalatedEvent = z
  .object({
    kind: z.literal("escalated"),
    ...base,
    pr,
    issue: issue.nullable(),
    path_tier: tier.nullable(),
    tier: tier.nullable(),
    paths: z.json(),
    evidence: z.json(),
  })
  .strict();

const WaiverUsedEvent = z
  .object({
    kind: z.literal("waiver_used"),
    ...base,
    pr,
    waiver: z.string().min(1),
    finding: z.json(),
  })
  .strict();

const MergedEvent = z
  .object({
    kind: z.literal("merged"),
    ...base,
    pr,
    issue: issue.nullable(),
    base: z.string().min(1),
    tier: tier.nullable(),
  })
  .strict();

const FindingOverdueEvent = z
  .object({
    kind: z.literal("finding_overdue"),
    ...base,
    issue,
    due: z.string().nullable(),
    source: z.string().nullable(),
  })
  .strict();

const DeferredEvent = z
  .object({
    kind: z.literal("deferred"),
    ...base,
    pr,
    issue: issue.nullable(),
    tier: tier.nullable(),
    /** The numbers of the Deferred finding issues. */
    findings: z.array(issue),
  })
  .strict();

const DeferralClearedEvent = z
  .object({
    kind: z.literal("deferral_cleared"),
    ...base,
    issue,
    by: z.string().min(1),
    waiver: z.string().min(1).nullable(),
  })
  .strict();

const ControlEventLine = z.discriminatedUnion("kind", [
  GateEvent,
  EscalatedEvent,
  WaiverUsedEvent,
  MergedEvent,
  FindingOverdueEvent,
  DeferredEvent,
  DeferralClearedEvent,
]);

export type ControlEvent = z.output<typeof ControlEventLine> & {
  /** A time in the future counts as now. */
  at: Date;
};

export type ControlEventKind = ControlEvent["kind"];

export interface ControlEventsRead extends Omit<WindowRead<ControlEvent>, "items"> {
  events: ControlEvent[];
  /** The count of valid events of each kind. */
  counts: Record<ControlEventKind, number>;
}

export function controlEventsFolder(claudeDir: string): string {
  return path.join(claudeDir, "factory", "controls");
}

/** The valid Control events of the last 30 days, oldest first. An unknown kind is skipped and counted. */
export async function readControlEvents(claudeDir: string, now: Date): Promise<ControlEventsRead> {
  const { items, ...rest } = await readJsonlWindow(
    controlEventsFolder(claudeDir),
    ControlEventLine,
    (event) => parseLineTime(event.time),
    now,
  );
  const events = items
    .map(({ item, time }): ControlEvent => ({ ...item, at: time }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const counts: Record<ControlEventKind, number> = {
    gate: 0,
    escalated: 0,
    waiver_used: 0,
    merged: 0,
    finding_overdue: 0,
    deferred: 0,
    deferral_cleared: 0,
  };
  for (const event of events) counts[event.kind] += 1;
  return { ...rest, events, counts };
}
