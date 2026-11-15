import { type Database, schema } from "@foreman/db";
import type { SessionKind, SessionSummary } from "@foreman/shared";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { paginate, type CursorKey, type Page } from "../paging.ts";
import { AMBIGUOUS_SKILL } from "../usage/skills.ts";
import { labelProjects, projectId } from "../usage/projects.ts";

export interface SessionsRequest {
  day: string;
  tz: string;
  /** The Project keys of the client, or null for "All". */
  clientKeys: readonly string[] | null;
  /** Only this session, for the session route. */
  sessionId?: string;
  limit: number;
  cursor: string | undefined;
  /** The query values that the cursor is bound to. */
  cursorQuery: Readonly<Record<string, string | undefined>>;
}

export interface SessionsPage {
  sessions: SessionSummary[];
  total: number;
  nextCursor: string | null;
}

interface DayRow {
  id: string;
  start: Date;
  end: Date;
  tokens: number;
  turns: number;
}

const LOOP_KINDS: readonly (readonly [string, SessionKind])[] = [
  ["factory-run", "unattended-loop"],
  ["factory-next", "attended-loop"],
];

const MAX_PROJECTS = 3;

/** The part of a skill name after the last `:`. */
function bareSkill(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

/** Newest start first, then by session ID. The key is the start in ms and the ID. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  const byStart = Number(b[0]) - Number(a[0]);
  if (byStart !== 0) return byStart;
  const left = String(a[1]);
  const right = String(b[1]);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The sessions with Turns on one local day in scope, one page of them with their numbers. */
export async function querySessions(db: Database, request: SessionsRequest): Promise<SessionsPage> {
  const { day, tz, clientKeys } = request;
  const dayStart = sql`(${day}::date)::timestamp at time zone ${tz}::text`;
  const dayEnd = sql`((${day}::date + 1)::timestamp at time zone ${tz}::text)`;
  const inScope = (project: AnyPgColumn): SQL | undefined =>
    clientKeys === null ? undefined : inArray(project, [...clientKeys]);

  const onDay = and(
    gte(schema.turns.time, dayStart),
    lt(schema.turns.time, dayEnd),
    inScope(schema.turns.projectKey),
    request.sessionId === undefined ? undefined : eq(schema.turns.sessionId, request.sessionId),
  );

  // The index on the Turn time bounds this read to the Turns of the day.
  const rows: DayRow[] = (
    await db
      .select({
        id: schema.turns.sessionId,
        start: sql<Date>`min(${schema.turns.time})`.mapWith(schema.turns.time),
        end: sql<Date>`max(${schema.turns.time})`.mapWith(schema.turns.time),
        tokens: sql<number>`coalesce(sum(${schema.turns.inputTokens} + ${schema.turns.outputTokens} + ${schema.turns.cacheWrite5mTokens} + ${schema.turns.cacheWrite1hTokens} + ${schema.turns.cacheReadTokens}), 0)::float8`,
        turns: sql<number>`count(*)::float8`,
      })
      .from(schema.turns)
      .where(onDay)
      .groupBy(schema.turns.sessionId)
  ).sort((a, b) => compareKeys([a.start.getTime(), a.id], [b.start.getTime(), b.id]));

  const page: Page<DayRow> = paginate(rows, {
    limit: request.limit,
    cursor: request.cursor,
    query: request.cursorQuery,
    keyOf: (row) => [row.start.getTime(), row.id],
    compare: compareKeys,
  });
  const ids = page.items.map((row) => row.id);
  if (ids.length === 0) {
    return { sessions: [], total: rows.length, nextCursor: null };
  }

  const [continues, projectRows, nameRows, kindRows, messageRows] = await Promise.all([
    db
      .select({
        id: schema.turns.sessionId,
        before: sql<boolean>`bool_or(${schema.turns.time} < ${dayStart})`,
        after: sql<boolean>`bool_or(${schema.turns.time} >= ${dayEnd})`,
      })
      .from(schema.turns)
      .where(and(inArray(schema.turns.sessionId, ids), inScope(schema.turns.projectKey)))
      .groupBy(schema.turns.sessionId),
    db
      .select({
        id: schema.turns.sessionId,
        key: schema.turns.projectKey,
        noRepo: schema.projects.noRepo,
        tokens: sql<number>`coalesce(sum(${schema.turns.inputTokens} + ${schema.turns.outputTokens} + ${schema.turns.cacheWrite5mTokens} + ${schema.turns.cacheWrite1hTokens} + ${schema.turns.cacheReadTokens}), 0)::float8`,
      })
      .from(schema.turns)
      .leftJoin(schema.projects, eq(schema.projects.projectKey, schema.turns.projectKey))
      .where(and(onDay, inArray(schema.turns.sessionId, ids)))
      .groupBy(schema.turns.sessionId, schema.turns.projectKey, schema.projects.noRepo),
    db
      .selectDistinctOn([schema.turns.sessionId], {
        id: schema.turns.sessionId,
        name: schema.turns.skillName,
      })
      .from(schema.turns)
      .where(
        and(
          onDay,
          inArray(schema.turns.sessionId, ids),
          ne(schema.turns.skillName, AMBIGUOUS_SKILL),
        ),
      )
      .orderBy(schema.turns.sessionId, asc(schema.turns.time), asc(schema.turns.turnKey)),
    // The kind reads the main conversation on all days and in all Projects.
    db
      .selectDistinct({ id: schema.skillCalls.sessionId, name: schema.skillCalls.skillName })
      .from(schema.skillCalls)
      .where(
        and(inArray(schema.skillCalls.sessionId, ids), sql`${schema.skillCalls.agentId} is null`),
      ),
    db
      .select({
        id: schema.userMessages.sessionId,
        count: sql<number>`count(*)::float8`,
      })
      .from(schema.userMessages)
      .where(
        and(
          inArray(schema.userMessages.sessionId, ids),
          gte(schema.userMessages.time, dayStart),
          lt(schema.userMessages.time, dayEnd),
          inScope(schema.userMessages.projectKey),
        ),
      )
      .groupBy(schema.userMessages.sessionId),
  ]);

  const continuesById = new Map(continues.map((row) => [row.id, row]));
  const names = new Map(nameRows.map((row) => [row.id, row.name]));
  const messages = new Map(messageRows.map((row) => [row.id, row.count]));

  const skillsById = new Map<string, Set<string>>();
  for (const { id, name } of kindRows) {
    const set = skillsById.get(id) ?? new Set<string>();
    set.add(bareSkill(name));
    skillsById.set(id, set);
  }

  const labels = labelProjects(
    [...new Map(projectRows.map((row) => [row.key, row.noRepo ?? false]))].map(([key, noRepo]) => ({
      key,
      noRepo,
    })),
  );
  const projectsById = new Map<string, typeof projectRows>();
  for (const row of projectRows) {
    projectsById.set(row.id, [...(projectsById.get(row.id) ?? []), row]);
  }

  const sessions = page.items.map((row): SessionSummary => {
    const own = [...(projectsById.get(row.id) ?? [])].sort(
      (a, b) => b.tokens - a.tokens || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    const skills = skillsById.get(row.id);
    const kind = LOOP_KINDS.find(([skill]) => skills?.has(skill) === true)?.[1] ?? "session";
    return {
      id: row.id,
      name: names.get(row.id) ?? null,
      kind,
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      continuesBefore: continuesById.get(row.id)?.before ?? false,
      continuesAfter: continuesById.get(row.id)?.after ?? false,
      projects: own.slice(0, MAX_PROJECTS).map((project) => ({
        id: projectId(project.key),
        label: labels.get(project.key) ?? project.key,
      })),
      projectCount: own.length,
      tokens: row.tokens,
      turns: row.turns,
      userMessages: messages.get(row.id) ?? 0,
    };
  });

  return { sessions, total: rows.length, nextCursor: page.nextCursor };
}
