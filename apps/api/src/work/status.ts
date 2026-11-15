import path from "node:path";
import { schema, type Database } from "@foreman/db";
import type { WorkStatusResponse } from "@foreman/shared";
import { desc, eq } from "drizzle-orm";
import { NOT_CONFIGURED_STATE } from "./fetch-repo.ts";
import { readRepoList, type RepoEntry } from "./repo-list.ts";
import type { FetchSchedule } from "./schedule.ts";
import { NO_TOKEN_STATE, TOKEN_REFUSED_STATE } from "./tokens.ts";

export const CONNECTED_STATE = "connected";
export const NOT_FETCHED_STATE = "not fetched";
const TOKEN_REJECTED_STATE = "token rejected";
/** A token state of a role, most serious first. One of them decides the state of its owner. */
const OWNER_PROBLEMS = [NO_TOKEN_STATE, TOKEN_REFUSED_STATE, TOKEN_REJECTED_STATE];

interface RepoRow {
  id: string;
  forgeState: string | null;
  forgeErrorClass: string | null;
  trackerState: string | null;
  trackerErrorClass: string | null;
  lastGoodFetchAt: Date | null;
}

function ownerState(rows: readonly RepoRow[]): string {
  const states = rows.flatMap((row) => [row.forgeState, row.trackerState]);
  for (const problem of OWNER_PROBLEMS) {
    if (states.includes(problem)) return problem;
  }
  const seen = states.filter((state) => state !== null && state !== NOT_CONFIGURED_STATE);
  return seen.length === 0 ? NOT_FETCHED_STATE : CONNECTED_STATE;
}

function fullName(repo: RepoEntry): string {
  return repo.owner === null || repo.name === null
    ? path.basename(repo.path)
    : `${repo.owner}/${repo.name}`;
}

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

/** The fetch state, the last fetches, and the connection state of each owner and repo. */
export async function readWorkStatus(
  db: Database,
  claudeDir: string,
  schedule: FetchSchedule,
): Promise<WorkStatusResponse> {
  const list = await readRepoList(claudeDir);
  const [last] = await db
    .select({
      startedAt: schema.workFetchRuns.startedAt,
      endedAt: schema.workFetchRuns.endedAt,
      failureReason: schema.workFetchRuns.failureReason,
    })
    .from(schema.workFetchRuns)
    .orderBy(desc(schema.workFetchRuns.startedAt))
    .limit(1);
  const [lastFull] = await db
    .select({ startedAt: schema.workFetchRuns.startedAt, endedAt: schema.workFetchRuns.endedAt })
    .from(schema.workFetchRuns)
    .where(eq(schema.workFetchRuns.kind, "full"))
    .orderBy(desc(schema.workFetchRuns.startedAt))
    .limit(1);
  const cached = await db
    .select({
      id: schema.workRepos.id,
      forgeState: schema.workRepos.forgeState,
      forgeErrorClass: schema.workRepos.forgeErrorClass,
      trackerState: schema.workRepos.trackerState,
      trackerErrorClass: schema.workRepos.trackerErrorClass,
      lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
    })
    .from(schema.workRepos);
  const byId = new Map(cached.map((row) => [row.id, row]));

  const repos = list.status === "ok" ? list.repos : [];
  const groups = new Map<string, { host: string; owner: string; rows: RepoRow[] }>();
  for (const repo of repos) {
    if (repo.owner === null) continue;
    const key = `${repo.host}/${repo.owner}`.toLowerCase();
    const group = groups.get(key) ?? { host: repo.host, owner: repo.owner, rows: [] };
    const row = byId.get(repo.id);
    if (row !== undefined) group.rows.push(row);
    groups.set(key, group);
  }

  const now = schedule.state();
  return {
    state: now.state,
    reason: now.reason ?? last?.failureReason ?? null,
    lastFetchStartedAt: iso(last?.startedAt),
    lastFetchAt: iso(last?.endedAt),
    lastFullFetchStartedAt: iso(lastFull?.startedAt),
    lastFullFetchAt: iso(lastFull?.endedAt),
    problems: list.status === "ok" ? list.problems : [],
    owners: [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, group]) => ({
        host: group.host,
        owner: group.owner,
        state: ownerState(group.rows),
      })),
    repos: repos
      .map((repo) => {
        const row = byId.get(repo.id);
        const named = repo.owner !== null;
        return {
          id: repo.id,
          fullName: fullName(repo),
          forgeState: named ? (row?.forgeState ?? null) : "not connected: no forge name",
          forgeErrorClass: row?.forgeErrorClass ?? null,
          trackerState: named ? (row?.trackerState ?? null) : "not connected: no forge name",
          trackerErrorClass: row?.trackerErrorClass ?? null,
          dataAsOf: iso(row?.lastGoodFetchAt),
        };
      })
      .sort((a, b) => (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0)),
  };
}
