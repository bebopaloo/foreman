import type { WorkItem } from "@foreman/shared";
import { MISSING } from "../format/index.ts";

/** The colour of a value. Each value also has its text label, so colour is never the only signal. */
export type Tone = "ok" | "warn" | "danger" | "info" | "plain";

const STATE_TONES: Record<string, Tone> = {
  TODO: "plain",
  READY: "info",
  "IN PROGRESS": "warn",
  "IN REVIEW": "info",
  BLOCKED: "danger",
  DONE: "ok",
  CANCELLED: "plain",
};

const GATE_TONES: Record<string, Tone> = {
  pass: "ok",
  fail: "danger",
  blocked: "danger",
  pending: "warn",
  wait: "warn",
  none: "plain",
};

const TIER_TONES: Record<string, Tone> = {
  authority: "danger",
  sensitive: "warn",
  general: "info",
  inert: "plain",
};

export const stateTone = (state: string): Tone => STATE_TONES[state] ?? "plain";
export const gateTone = (value: string): Tone => GATE_TONES[value] ?? "plain";
export const tierTone = (tier: string): Tone => TIER_TONES[tier] ?? "plain";

/** The State column. An item with no issue shows "no issue". A closed issue with no end state shows "TODO · closed". */
export function stateLabel(item: WorkItem): string {
  if (item.issue === null) return "no issue";
  if (item.issue.state === "closed" && item.issue.issueState === "TODO") return "TODO · closed";
  return item.issue.issueState;
}

export function gateLabel(item: WorkItem): string | null {
  if (item.machineGate === null) return null;
  return item.machineGate.source === "events"
    ? `${item.machineGate.value} (event)`
    : item.machineGate.value;
}

export const priorityLabel = (item: WorkItem): string => item.issue?.priority ?? MISSING;

/** A link of the API shows only when it is a web address. The API checks it too. */
export const safeLink = (link: string | null): string | null =>
  link !== null && /^https?:\/\//.test(link) ? link : null;

export const itemKey = (item: WorkItem): string =>
  item.issue
    ? `${item.repoId ?? item.fullName}:i:${item.issue.number.toString()}`
    : `${item.repoId ?? item.fullName}:p:${(item.pullRequest?.number ?? 0).toString()}`;

/** A row with no repo in the repo list, or with no issue and no pull request, is not in the Work cache. It has no links. */
export const notInWorkCache = (item: WorkItem): boolean =>
  item.repoId === null || (item.issue === null && item.pullRequest === null);
