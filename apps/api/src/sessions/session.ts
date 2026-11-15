import { schema, type Database } from "@foreman/db";
import {
  SESSION_USER_MESSAGE_LIMIT,
  type SessionResponse,
  type SessionSpan,
} from "@foreman/shared";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { paginate, type CursorKey } from "../paging.ts";
import { labelProjects, projectId } from "../usage/projects.ts";
import type { RepoEntry } from "../work/repo-list.ts";
import type { ScopedRepo } from "../work/scope.ts";
import { querySessions } from "./sessions.ts";
import { buildSpans, readSpanTurns, type AgentSpan } from "./spans.ts";
import { loadWorkItemSource, workCompleteness, workItemOf, type WorkRef } from "./work-items.ts";

export interface SessionRequest {
  sessionId: string;
  day: string;
  tz: string;
  clientKeys: readonly string[] | null;
  limit: number;
  cursor: string | undefined;
  /** The query values that the cursor is bound to. */
  cursorQuery: Readonly<Record<string, string | undefined>>;
  /** All repo list entries: they map a Project key to a repo. */
  entries: readonly RepoEntry[];
  /** The entries of the client scope, or all entries with no client. */
  scopeEntries: readonly RepoEntry[];
  /** The repos of the scope that have a token. */
  readable: readonly ScopedRepo[];
}

/** Earliest start first, then by span key. The key is the start in ms and the span key. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  const byStart = Number(a[0]) - Number(b[0]);
  if (byStart !== 0) return byStart;
  const left = String(a[1]);
  const right = String(b[1]);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** One session of the day in scope with a page of its spans, or null when it has no Turn there. */
export async function querySession(
  db: Database,
  request: SessionRequest,
): Promise<SessionResponse | null> {
  const { sessionId, day, tz, clientKeys } = request;
  const found = await querySessions(db, {
    day,
    tz,
    clientKeys,
    sessionId,
    limit: 1,
    cursor: undefined,
    cursorQuery: {},
  });
  const session = found.sessions[0];
  if (session === undefined) return null;

  const dayStart = sql`(${day}::date)::timestamp at time zone ${tz}::text`;
  const dayEnd = sql`((${day}::date + 1)::timestamp at time zone ${tz}::text)`;
  const scoped = (project: AnyPgColumn) =>
    clientKeys === null ? undefined : inArray(project, [...clientKeys]);

  const turns = await readSpanTurns(
    db,
    and(
      eq(schema.turns.sessionId, sessionId),
      gte(schema.turns.time, dayStart),
      lt(schema.turns.time, dayEnd),
      scoped(schema.turns.projectKey),
    ),
  );

  const onDay = and(
    eq(schema.userMessages.sessionId, sessionId),
    gte(schema.userMessages.time, dayStart),
    lt(schema.userMessages.time, dayEnd),
    scoped(schema.userMessages.projectKey),
  );
  const [messageTimes, [messageStats]] = await Promise.all([
    db
      .select({ time: schema.userMessages.time })
      .from(schema.userMessages)
      .where(onDay)
      .orderBy(asc(schema.userMessages.time), asc(schema.userMessages.recordId))
      .limit(SESSION_USER_MESSAGE_LIMIT),
    db
      .select({
        total: sql<number>`count(*)::float8`,
        first: sql<Date | null>`min(${schema.userMessages.time})`.mapWith(schema.userMessages.time),
        last: sql<Date | null>`max(${schema.userMessages.time})`.mapWith(schema.userMessages.time),
      })
      .from(schema.userMessages)
      .where(onDay),
  ]);

  const times = [new Date(session.start), new Date(session.end)];
  if (messageStats?.first != null) times.push(messageStats.first);
  if (messageStats?.last != null) times.push(messageStats.last);
  const windowStart = Math.min(...times.map((time) => time.getTime()));
  const windowEnd = Math.max(...times.map((time) => time.getTime()));

  const spans = buildSpans(turns);
  const page = paginate(spans, {
    limit: request.limit,
    cursor: request.cursor,
    query: { ...request.cursorQuery, session: sessionId },
    keyOf: (span) => [span.start.getTime(), span.key],
    compare: compareKeys,
  });

  const projectKeys = [...new Set(spans.map((span) => span.projectKey))];
  const projectRows =
    projectKeys.length === 0
      ? []
      : await db
          .select({ key: schema.projects.projectKey, noRepo: schema.projects.noRepo })
          .from(schema.projects)
          .where(inArray(schema.projects.projectKey, projectKeys));
  const noRepo = new Map(projectRows.map((row) => [row.key, row.noRepo]));
  const labels = labelProjects(
    projectKeys.map((key) => ({ key, noRepo: noRepo.get(key) ?? false })),
  );

  const refs: WorkRef[] = page.items.flatMap((span) => span.workRefs);
  const source = await loadWorkItemSource(db, request.entries, request.readable, refs);
  const complete = await workCompleteness(db, request.scopeEntries, request.readable);

  return {
    session,
    window: {
      start: new Date(windowStart).toISOString(),
      end: new Date(windowEnd).toISOString(),
    },
    userMessages: messageTimes.map((row) => row.time.toISOString()),
    userMessageTotal: messageStats?.total ?? 0,
    spans: page.items.map((span: AgentSpan): SessionSpan => ({
      key: span.key,
      kind: span.kind,
      agentType: span.kind === "main" ? "main" : span.agentType,
      skill: span.skill,
      skillBasis: span.skillBasis,
      models: span.models,
      project: {
        id: projectId(span.projectKey),
        label: labels.get(span.projectKey) ?? span.projectKey,
      },
      workItem: workItemOf(span.workRefs, source),
      start: span.start.toISOString(),
      end: span.end.toISOString(),
      turns: span.turns,
      inputTokens: span.inputTokens,
      outputTokens: span.outputTokens,
      cacheWriteTokens: span.cacheWriteTokens,
      cacheReadTokens: span.cacheReadTokens,
      tokens: span.tokens,
    })),
    spanTotal: spans.length,
    nextCursor: page.nextCursor,
    complete,
  };
}
