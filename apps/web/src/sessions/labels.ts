import type { SessionKind, SessionSpan, SpanWorkItem } from "@foreman/shared";

const KIND_LABELS: Record<SessionKind, string> = {
  "unattended-loop": "Unattended loop",
  "attended-loop": "Attended loop",
  session: "Session",
};

export const kindLabel = (kind: SessionKind): string => KIND_LABELS[kind];

/** The label of a span: its Agent type, then its skill, with "(estimate)" when the skill is an estimate. */
export function spanLabel(span: Pick<SessionSpan, "agentType" | "skill" | "skillBasis">): string {
  if (span.skill === null) return span.agentType;
  const estimate = span.skillBasis === "estimate" ? " (estimate)" : "";
  return `${span.agentType} · ${span.skill}${estimate}`;
}

export function messagesFromYou(count: number): string {
  return `${count.toString()} ${count === 1 ? "message" : "messages"} from you`;
}

export function reposNotConnected(count: number): string {
  return `${count.toString()} ${count === 1 ? "repo" : "repos"} not connected`;
}

const KNOWN_AGENT_TYPES = new Set([
  "main",
  "software-developer",
  "review-finder",
  "review-verifier",
  "review-resolver",
]);

/** The class that gives a bar its Agent type colour. Every other Agent type has one neutral colour. */
export function agentClass(agentType: string): string {
  return KNOWN_AGENT_TYPES.has(agentType) ? `agent-${agentType}` : "agent-other";
}

/** The reference of a work item with one issue: "acme/app #212", or "#7" with no repo. */
export function workItemRef(item: Extract<SpanWorkItem, { kind: "one" }>): string {
  return `${item.fullName === null ? "" : `${item.fullName} `}#${item.number.toString()}`;
}

/** The plain text of a work item, for the table: the reference and the title. */
export function workItemText(item: SpanWorkItem): string {
  if (item.kind === "none") return "None";
  if (item.kind === "several") return `${item.count.toString()} work items`;
  return item.title === null ? workItemRef(item) : `${workItemRef(item)} ${item.title}`;
}

/** A link from the API, only when it is a web address. Any other scheme gives no link. */
export function safeHref(link: string | null): string | null {
  if (link === null) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function modelsText(models: SessionSpan["models"]): string {
  return models.map((entry) => `${entry.model} (${entry.turns.toString()})`).join(", ");
}
