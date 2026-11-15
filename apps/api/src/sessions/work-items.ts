import { schema, type Database } from "@foreman/db";
import type { SpanWorkItem } from "@foreman/shared";
import { and, eq, inArray } from "drizzle-orm";
import { safeLink } from "../work/fetch-repo.ts";
import type { RepoEntry } from "../work/repo-list.ts";
import type { ScopedRepo } from "../work/scope.ts";

const ISSUE_PREFIX = /^([1-9][0-9]{0,8})-/;

function numberOf(name: string | null): number | null {
  const match = name === null ? null : ISSUE_PREFIX.exec(name);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * The issue number of a Turn: the worktree name first, then the branch. Claude Code can write
 * the branch of a linked worktree as `HEAD`, so the worktree name is the better source.
 */
export function issueNumberOf(worktreeName: string | null, branch: string | null): number | null {
  return numberOf(worktreeName) ?? numberOf(branch);
}

/** One work item of a span: the Project of its Turns and the issue number. */
export interface WorkRef {
  projectKey: string;
  number: number;
}

/** What the work items of spans need from the Work cache. */
export interface WorkItemSource {
  /** The repo list entry of each Project key. */
  entryByProject: ReadonlyMap<string, RepoEntry>;
  /** The repos that the Work cache may show: those with a token, in scope. */
  readable: ReadonlyMap<string, ScopedRepo>;
  /** The cached issues of those repos, by repo ID and number. */
  issues: ReadonlyMap<string, { title: string; link: string | null }>;
}

const issueKey = (repoId: string, number: number): string => `${repoId}#${String(number)}`;

/** The cached titles and links of the work items of the spans. */
export async function loadWorkItemSource(
  db: Database,
  entries: readonly RepoEntry[],
  readable: readonly ScopedRepo[],
  refs: Iterable<WorkRef>,
): Promise<WorkItemSource> {
  const entryByProject = new Map<string, RepoEntry>();
  for (const entry of entries) {
    if (!entryByProject.has(entry.path)) entryByProject.set(entry.path, entry);
  }
  const readableById = new Map(readable.map((repo) => [repo.id, repo]));

  const numbersByRepo = new Map<string, Set<number>>();
  for (const ref of refs) {
    const entry = entryByProject.get(ref.projectKey);
    if (entry === undefined || !readableById.has(entry.id)) continue;
    const numbers = numbersByRepo.get(entry.id) ?? new Set<number>();
    numbers.add(ref.number);
    numbersByRepo.set(entry.id, numbers);
  }

  const issues = new Map<string, { title: string; link: string | null }>();
  // One query for each repo: the number filter is the narrowest index lookup.
  await Promise.all(
    [...numbersByRepo].map(async ([repoId, numbers]) => {
      const rows = await db
        .select({
          number: schema.workIssues.number,
          title: schema.workIssues.title,
          link: schema.workIssues.link,
        })
        .from(schema.workIssues)
        .where(
          and(
            eq(schema.workIssues.repoId, repoId),
            inArray(schema.workIssues.number, [...numbers]),
          ),
        );
      const host = readableById.get(repoId)?.host;
      for (const row of rows) {
        // The link check runs again on read, against the host of the repo.
        issues.set(issueKey(repoId, row.number), {
          title: row.title,
          link: row.link === null || host === undefined ? null : safeLink(row.link, host),
        });
      }
    }),
  );
  return { entryByProject, readable: readableById, issues };
}

function fullNameOf(entry: RepoEntry): string | null {
  return entry.owner === null || entry.name === null ? null : `${entry.owner}/${entry.name}`;
}

/** The work item of a span from its work refs. Two or more different items give a count only. */
export function workItemOf(refs: readonly WorkRef[], source: WorkItemSource): SpanWorkItem {
  const distinct = new Map<string, WorkRef>();
  for (const ref of refs) distinct.set(`${ref.projectKey}\u0000${String(ref.number)}`, ref);
  const items = [...distinct.values()];
  const [first] = items;
  if (first === undefined) return { kind: "none" };
  if (items.length > 1) return { kind: "several", count: items.length };

  const entry = source.entryByProject.get(first.projectKey);
  if (entry === undefined) {
    return {
      kind: "one",
      repoId: null,
      fullName: null,
      number: first.number,
      title: null,
      link: null,
    };
  }
  const cached = source.readable.has(entry.id)
    ? source.issues.get(issueKey(entry.id, first.number))
    : undefined;
  return {
    kind: "one",
    repoId: entry.id,
    fullName: fullNameOf(entry),
    number: first.number,
    title: cached?.title ?? null,
    link: cached?.link ?? null,
  };
}

export interface WorkCompleteness {
  incompleteRepos: number;
  notConnected: boolean;
}

/**
 * The repos of the client scope that the view cannot fully read: no token, no good fetch, or a
 * fetch error. With no repo that has cache rows, the view is "not connected".
 */
export async function workCompleteness(
  db: Database,
  inClient: readonly RepoEntry[],
  readable: readonly ScopedRepo[],
): Promise<WorkCompleteness> {
  const named = inClient.filter((entry) => entry.owner !== null && entry.name !== null);
  const readableIds = new Set(readable.map((repo) => repo.id));
  const rows = await db
    .select({
      id: schema.workRepos.id,
      forgeErrorClass: schema.workRepos.forgeErrorClass,
      trackerErrorClass: schema.workRepos.trackerErrorClass,
      lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
    })
    .from(schema.workRepos);
  const byId = new Map(rows.map((row) => [row.id, row]));

  let incompleteRepos = 0;
  let connected = 0;
  for (const entry of named) {
    const row = byId.get(entry.id);
    if (row === undefined || row.lastGoodFetchAt === null || !readableIds.has(entry.id)) {
      incompleteRepos += 1;
      continue;
    }
    connected += 1;
    if (row.forgeErrorClass !== null || row.trackerErrorClass !== null) incompleteRepos += 1;
  }
  return { incompleteRepos, notConnected: connected === 0 };
}
