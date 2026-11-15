import { schema, type Database } from "@foreman/db";
import { and, asc, gte, inArray, isNotNull, lt, type SQL } from "drizzle-orm";
import { issueNumberOf, type WorkRef } from "./work-items.ts";

/** The columns of one Turn that a span needs. A Turn holds no text. */
export interface SpanTurn {
  turnKey: string;
  sessionId: string;
  time: Date;
  model: string;
  speed: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  projectKey: string;
  branch: string | null;
  worktreeName: string | null;
  agentType: string;
  agentId: string | null;
  skillName: string | null;
  skillBasis: string | null;
}

export interface SpanModel {
  model: string;
  turns: number;
}

/** An Agent span of the Sessions view spec. */
export interface AgentSpan {
  /** `a:<agent ID>` for a sub-agent, `m:<turn key of its first Turn>` for a main span. */
  key: string;
  kind: "main" | "sub-agent";
  sessionId: string;
  agentType: string;
  skill: string | null;
  skillBasis: "exact" | "estimate" | null;
  models: SpanModel[];
  projectKey: string;
  workRefs: WorkRef[];
  start: Date;
  end: Date;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  tokens: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function basisOf(value: string | null): "exact" | "estimate" | null {
  return value === "exact" || value === "estimate" ? value : null;
}

function modelName(turn: SpanTurn): string {
  return turn.speed === "fast" ? `${turn.model} (fast)` : turn.model;
}

function compareTurns(a: SpanTurn, b: SpanTurn): number {
  return a.time.getTime() - b.time.getTime() || byText(a.turnKey, b.turnKey);
}

function summarise(
  kind: AgentSpan["kind"],
  key: string,
  turns: readonly SpanTurn[],
): AgentSpan | null {
  const first = turns[0];
  const last = turns.at(-1);
  if (first === undefined || last === undefined) return null;

  const modelCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  const refs: WorkRef[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  for (const turn of turns) {
    modelCounts.set(modelName(turn), (modelCounts.get(modelName(turn)) ?? 0) + 1);
    projectCounts.set(turn.projectKey, (projectCounts.get(turn.projectKey) ?? 0) + 1);
    const number = issueNumberOf(turn.worktreeName, turn.branch);
    if (number !== null) refs.push({ projectKey: turn.projectKey, number });
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    cacheWriteTokens += turn.cacheWriteTokens;
    cacheReadTokens += turn.cacheReadTokens;
  }
  const skilled = turns.find((turn) => turn.skillName !== null);
  const project = [...projectCounts].sort(([a, x], [b, y]) => y - x || byText(a, b))[0];

  return {
    key,
    kind,
    sessionId: first.sessionId,
    agentType: first.agentType,
    skill: skilled?.skillName ?? null,
    skillBasis: skilled === undefined ? null : basisOf(skilled.skillBasis),
    models: [...modelCounts]
      .map(([model, count]) => ({ model, turns: count }))
      .sort((a, b) => b.turns - a.turns || byText(a.model, b.model)),
    projectKey: project?.[0] ?? first.projectKey,
    workRefs: refs,
    start: first.time,
    end: last.time,
    turns: turns.length,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    tokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
  };
}

/** The identity that decides where a run of main-conversation Turns ends. */
function mainRunKey(turn: SpanTurn): string {
  return JSON.stringify([
    turn.skillName,
    turn.skillBasis,
    turn.projectKey,
    issueNumberOf(turn.worktreeName, turn.branch),
  ]);
}

/** Orders spans by start time, then by span key. */
export function compareSpans(
  a: Pick<AgentSpan, "start" | "key">,
  b: Pick<AgentSpan, "start" | "key">,
): number {
  return a.start.getTime() - b.start.getTime() || byText(a.key, b.key);
}

/**
 * The Agent spans of some Turns, by start time. One span for each sub-agent of a session, and one
 * for each run of main-conversation Turns with the same skill, basis, Project and issue number.
 * With `mainSpans` false, only the sub-agent spans come back.
 */
export function buildSpans(turns: readonly SpanTurn[], mainSpans = true): AgentSpan[] {
  const ordered = [...turns].sort(compareTurns);
  const agents = new Map<string, SpanTurn[]>();
  const spans: AgentSpan[] = [];

  let run: SpanTurn[] = [];
  let runKey: string | null = null;
  const closeRun = () => {
    const first = run[0];
    if (first !== undefined) {
      const span = summarise("main", `m:${first.turnKey}`, run);
      if (span !== null) spans.push(span);
    }
    run = [];
    runKey = null;
  };

  for (const turn of ordered) {
    if (turn.agentId !== null) {
      // An agent ID is not unique across sessions, so the session ID is part of the group.
      const group = JSON.stringify([turn.sessionId, turn.agentId]);
      agents.set(group, [...(agents.get(group) ?? []), turn]);
      continue;
    }
    if (!mainSpans) continue;
    const key = `${turn.sessionId}\u0000${mainRunKey(turn)}`;
    if (key !== runKey) closeRun();
    runKey = key;
    run.push(turn);
  }
  closeRun();

  for (const group of agents.values()) {
    const first = group[0];
    if (first?.agentId == null) continue;
    const span = summarise("sub-agent", `a:${first.agentId}`, group);
    if (span !== null) spans.push(span);
  }
  return spans.sort(compareSpans);
}

const turnColumns = {
  turnKey: schema.turns.turnKey,
  sessionId: schema.turns.sessionId,
  time: schema.turns.time,
  model: schema.turns.model,
  speed: schema.turns.speed,
  inputTokens: schema.turns.inputTokens,
  outputTokens: schema.turns.outputTokens,
  cacheWrite5m: schema.turns.cacheWrite5mTokens,
  cacheWrite1h: schema.turns.cacheWrite1hTokens,
  cacheReadTokens: schema.turns.cacheReadTokens,
  projectKey: schema.turns.projectKey,
  branch: schema.turns.branch,
  worktreeName: schema.turns.worktreeName,
  agentType: schema.turns.agentType,
  agentId: schema.turns.agentId,
  skillName: schema.turns.skillName,
  skillBasis: schema.turns.skillBasis,
};

/** The Turns that match a condition, as the columns that spans need. */
export async function readSpanTurns(db: Database, where: SQL | undefined): Promise<SpanTurn[]> {
  const rows = await db
    .select(turnColumns)
    .from(schema.turns)
    .where(where)
    .orderBy(asc(schema.turns.time), asc(schema.turns.turnKey));
  return rows.map(({ cacheWrite5m, cacheWrite1h, ...rest }) => ({
    ...rest,
    cacheWriteTokens: cacheWrite5m + cacheWrite1h,
  }));
}

export interface WindowOptions {
  from: Date;
  /** The end of the window, not included. */
  to: Date;
  /** The Project keys of a client, or null for all Projects. */
  clientKeys: readonly string[] | null;
}

/**
 * The whole sub-agent spans of a time window: each sub-agent with a Turn in `[from, to)`, with all
 * its Turns, also those outside the window. The Reviews view uses it. The Project scope applies to
 * the Turns of the spans.
 */
export async function subAgentSpansInWindow(
  db: Database,
  { from, to, clientKeys }: WindowOptions,
): Promise<AgentSpan[]> {
  const inScope =
    clientKeys === null ? undefined : inArray(schema.turns.projectKey, [...clientKeys]);
  const inWindow = await db
    .selectDistinct({ sessionId: schema.turns.sessionId, agentId: schema.turns.agentId })
    .from(schema.turns)
    .where(
      and(
        isNotNull(schema.turns.agentId),
        gte(schema.turns.time, from),
        lt(schema.turns.time, to),
        inScope,
      ),
    );
  const agentIds = [
    ...new Set(inWindow.flatMap((row) => (row.agentId === null ? [] : [row.agentId]))),
  ];
  if (agentIds.length === 0) return [];
  const sessions = [...new Set(inWindow.map((row) => row.sessionId))];
  const turns = await readSpanTurns(
    db,
    and(
      inArray(schema.turns.agentId, agentIds),
      inArray(schema.turns.sessionId, sessions),
      inScope,
    ),
  );
  // The two `inArray` filters can bring a (session, agent) pair that has no Turn in the window.
  const wanted = new Set(inWindow.map((row) => JSON.stringify([row.sessionId, row.agentId])));
  return buildSpans(
    turns.filter((turn) => wanted.has(JSON.stringify([turn.sessionId, turn.agentId]))),
    false,
  );
}
