import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import { and, inArray, isNotNull } from "drizzle-orm";

export const AMBIGUOUS_SKILL = "(ambiguous)";

export type SkillBasis = "exact" | "estimate";

export interface SkillAssignment {
  skill: string;
  basis: SkillBasis;
}

// The commands of Claude Code itself. A slash command in this list is not a skill call.
const BUILT_IN_COMMANDS: ReadonlySet<string> = new Set([
  "add-dir",
  "agents",
  "bug",
  "clear",
  "compact",
  "config",
  "context",
  "cost",
  "doctor",
  "exit",
  "export",
  "help",
  "hooks",
  "ide",
  "init",
  "install-github-app",
  "login",
  "logout",
  "mcp",
  "memory",
  "model",
  "output-style",
  "permissions",
  "plugin",
  "pr-comments",
  "privacy-settings",
  "release-notes",
  "resume",
  "review",
  "rewind",
  "security-review",
  "status",
  "statusline",
  "terminal-setup",
  "todos",
  "usage",
  "vim",
]);

/** True for a command that Claude Code runs itself, so it is not a skill call. The name has no leading "/". */
export function isBuiltInCommand(name: string): boolean {
  return BUILT_IN_COMMANDS.has(name);
}

export interface AttributionTurn {
  turnKey: string;
  time: Date;
  agentId: string | null;
}

export interface AttributionCall {
  callId: string;
  agentId: string | null;
  messageId: string | null;
  time: Date;
  skillName: string;
}

export interface AttributionStart {
  callId: string;
  agentId: string | null;
  time: Date;
}

export interface AttributionAgent {
  agentId: string;
  startToolCallId: string | null;
}

export interface AttributionSession {
  turns: AttributionTurn[];
  calls: AttributionCall[];
  starts: AttributionStart[];
  agents: AttributionAgent[];
  /** The times of the real user messages of the main conversation. */
  userMessageTimes: Date[];
}

interface Span {
  start: number;
  skill: string;
  /** The ID of each call that opens the span. */
  callIds: Set<string>;
}

const MAX_AGENT_DEPTH = 20;

/** The index of the last value that is below `limit` in a sorted list, or -1. */
function lastIndexBefore(sorted: number[], limit: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? Infinity) < limit) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Groups the calls of the main conversation by assistant message. A slash command is its own group. */
function buildSpans(calls: AttributionCall[]): Span[] {
  const groups = new Map<string, AttributionCall[]>();
  for (const call of calls) {
    if (call.agentId !== null) continue;
    const key = call.messageId ?? `call:${call.callId}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  const spans = [...groups.values()].map((group) => {
    const names = new Set(group.map((call) => call.skillName));
    return {
      start: Math.max(...group.map((call) => call.time.getTime())),
      skill: names.size > 1 ? AMBIGUOUS_SKILL : (group[0]?.skillName ?? AMBIGUOUS_SKILL),
      callIds: new Set(group.map((call) => call.callId)),
    };
  });
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Skill attribution for the stored rows of one session. A turn of a sub-agent is exact when the
 * tool call that started the agent belongs to a skill. A turn of the main conversation is an
 * estimate: it lies in the span between a skill call and the next real user message or skill call.
 */
export function attributeSession(session: AttributionSession): Map<string, SkillAssignment> {
  const spans = buildSpans(session.calls);
  const spanStarts = spans.map((span) => span.start);
  const userTimes = session.userMessageTimes.map((time) => time.getTime()).sort((a, b) => a - b);
  const callById = new Map(session.calls.map((call) => [call.callId, call]));
  const startById = new Map(session.starts.map((start) => [start.callId, start]));
  const agentById = new Map(session.agents.map((agent) => [agent.agentId, agent]));

  /** The span that holds a main-conversation moment: after the span start, and before the next real user message. */
  function spanAt(time: number): Span | undefined {
    const index = lastIndexBefore(spanStarts, time);
    const found = spans[index];
    if (found === undefined) return undefined;
    // A real user message after the span start and not after the moment ends the span.
    const nextUser = userTimes[lastIndexBefore(userTimes, found.start + 1) + 1];
    return nextUser !== undefined && nextUser <= time ? undefined : found;
  }

  function spanAssignment(span: Span, basis: SkillBasis): SkillAssignment {
    return span.skill === AMBIGUOUS_SKILL
      ? { skill: AMBIGUOUS_SKILL, basis: "estimate" }
      : { skill: span.skill, basis };
  }

  function ofToolCall(callId: string, depth: number): SkillAssignment | undefined {
    const call = callById.get(callId);
    if (call !== undefined) return { skill: call.skillName, basis: "exact" };
    const start = startById.get(callId);
    if (start === undefined) return undefined;
    if (start.agentId === null) {
      const span = spanAt(start.time.getTime());
      return span === undefined ? undefined : spanAssignment(span, "exact");
    }
    return ofAgent(start.agentId, depth + 1);
  }

  const agentCache = new Map<string, SkillAssignment | undefined>();
  function ofAgent(agentId: string, depth = 0): SkillAssignment | undefined {
    if (agentCache.has(agentId)) return agentCache.get(agentId);
    if (depth > MAX_AGENT_DEPTH) return undefined;
    const startCall = agentById.get(agentId)?.startToolCallId;
    const result =
      startCall === null || startCall === undefined ? undefined : ofToolCall(startCall, depth);
    agentCache.set(agentId, result);
    return result;
  }

  const result = new Map<string, SkillAssignment>();
  for (const turn of session.turns) {
    const assignment =
      turn.agentId === null
        ? (() => {
            const span = spanAt(turn.time.getTime());
            return span === undefined ? undefined : spanAssignment(span, "estimate");
          })()
        : ofAgent(turn.agentId);
    if (assignment !== undefined) result.set(turn.turnKey, assignment);
  }
  return result;
}

const SESSION_CHUNK = 200;
const UPDATE_CHUNK = 5_000;

function groupBySession<T extends { sessionId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.sessionId, [...(grouped.get(row.sessionId) ?? []), row]);
  return grouped;
}

/**
 * Runs Skill attribution again for each session from its stored rows, and writes the skill and
 * the basis of each turn. The stored rows decide the result, so the order of the reads does not.
 */
export async function attributeSessions(
  db: Pick<Database, "select" | "update">,
  sessionIds: string[],
): Promise<void> {
  for (let start = 0; start < sessionIds.length; start += SESSION_CHUNK) {
    const chunk = sessionIds.slice(start, start + SESSION_CHUNK);
    const turns = await db
      .select({
        turnKey: schema.turns.turnKey,
        sessionId: schema.turns.sessionId,
        time: schema.turns.time,
        agentId: schema.turns.agentId,
      })
      .from(schema.turns)
      .where(inArray(schema.turns.sessionId, chunk));
    const calls = await db
      .select()
      .from(schema.skillCalls)
      .where(inArray(schema.skillCalls.sessionId, chunk));
    const starts = await db
      .select()
      .from(schema.agentStarts)
      .where(inArray(schema.agentStarts.sessionId, chunk));
    const messages = await db
      .select({ sessionId: schema.userMessages.sessionId, time: schema.userMessages.time })
      .from(schema.userMessages)
      .where(inArray(schema.userMessages.sessionId, chunk));
    const agents = await db
      .select()
      .from(schema.agents)
      .where(inArray(schema.agents.sessionId, chunk));

    const callsBySession = groupBySession(calls);
    const startsBySession = groupBySession(starts);
    const messagesBySession = groupBySession(messages);
    const agentsBySession = groupBySession(agents);
    const assignments = new Map<string, SkillAssignment>();
    for (const [sessionId, sessionTurns] of groupBySession(turns)) {
      const result = attributeSession({
        turns: sessionTurns,
        calls: callsBySession.get(sessionId) ?? [],
        starts: startsBySession.get(sessionId) ?? [],
        agents: agentsBySession.get(sessionId) ?? [],
        userMessageTimes: (messagesBySession.get(sessionId) ?? []).map((message) => message.time),
      });
      for (const [turnKey, assignment] of result) assignments.set(turnKey, assignment);
    }

    await db
      .update(schema.turns)
      .set({ skillName: null, skillBasis: null })
      .where(and(inArray(schema.turns.sessionId, chunk), isNotNull(schema.turns.skillName)));
    const byAssignment = new Map<string, { assignment: SkillAssignment; keys: string[] }>();
    for (const [turnKey, assignment] of assignments) {
      const id = `${assignment.basis}\u0000${assignment.skill}`;
      const entry = byAssignment.get(id) ?? { assignment, keys: [] };
      entry.keys.push(turnKey);
      byAssignment.set(id, entry);
    }
    for (const { assignment, keys } of byAssignment.values()) {
      for (let from = 0; from < keys.length; from += UPDATE_CHUNK) {
        await db
          .update(schema.turns)
          .set({ skillName: assignment.skill, skillBasis: assignment.basis })
          .where(inArray(schema.turns.turnKey, keys.slice(from, from + UPDATE_CHUNK)));
      }
    }
  }
}
