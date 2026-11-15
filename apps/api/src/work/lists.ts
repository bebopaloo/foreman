import { schema, type Database } from "@foreman/db";
import type { WorkIssue, WorkIssuesQuery, WorkPullRequest, WorkRelease } from "@foreman/shared";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { paginate, type CursorKey, type CursorQuery, type Page } from "../paging.ts";
import { safeLink } from "./fetch-repo.ts";
import type { ScopedRepo } from "./scope.ts";

interface ListInput {
  limit: number;
  cursor: string | undefined;
  query: CursorQuery;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Repo ID ascending, then the number from high to low. */
const compareByNumber = (a: CursorKey, b: CursorKey): number =>
  byText(String(a[0]), String(b[0])) || Number(b[1]) - Number(a[1]);

/** Repo ID ascending, then the name from high to low. */
const compareByName = (a: CursorKey, b: CursorKey): number =>
  byText(String(a[0]), String(b[0])) || byText(String(b[1]), String(a[1]));

/** The link check runs again on read, against the host of the repo, so that no stored value skips it. */
function linkFor(link: string | null, repo: ScopedRepo | undefined): string | null {
  return link === null || repo === undefined ? null : safeLink(link, repo.host);
}

/** An item is stale when the last listing of its repo did not include it. */
function newestListing(rows: readonly { repoId: string; lastListedAt: Date }[]) {
  const newest = new Map<string, number>();
  for (const row of rows) {
    const time = row.lastListedAt.getTime();
    if (time > (newest.get(row.repoId) ?? 0)) newest.set(row.repoId, time);
  }
  return (row: { repoId: string; lastListedAt: Date }): boolean =>
    row.lastListedAt.getTime() < (newest.get(row.repoId) ?? 0);
}

interface ReviewCount {
  author: string;
  state: string;
  count: number;
}

export async function listIssues(
  db: Database,
  repos: readonly ScopedRepo[],
  filters: Pick<WorkIssuesQuery, "issue_state" | "state">,
  input: ListInput,
): Promise<Page<WorkIssue>> {
  if (repos.length === 0) return { items: [], nextCursor: null };
  const table = schema.workIssues;
  const conditions: (SQL | undefined)[] = [
    inArray(
      table.repoId,
      repos.map((repo) => repo.id),
    ),
    filters.issue_state === undefined ? undefined : eq(table.issueState, filters.issue_state),
    filters.state === undefined ? undefined : eq(table.state, filters.state),
  ];
  const rows = await db
    .select({
      repoId: table.repoId,
      number: table.number,
      title: table.title,
      state: table.state,
      issueState: table.issueState,
      priority: table.priority,
      labels: table.labels,
      author: table.author,
      link: table.link,
      parent: table.parent,
      children: table.children,
      blockedBy: table.blockedBy,
      lastListedAt: table.lastListedAt,
    })
    .from(table)
    .where(and(...conditions));
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const isStale = newestListing(rows);
  const items = rows.map(({ lastListedAt, parent, children, blockedBy, link, ...row }) => ({
    ...row,
    link: linkFor(link, byId.get(row.repoId)),
    relations: { parent, children, blockedBy },
    stale: isStale({ repoId: row.repoId, lastListedAt }),
  }));
  items.sort((a, b) => compareByNumber([a.repoId, a.number], [b.repoId, b.number]));
  return paginate(items, {
    ...input,
    keyOf: (row) => [row.repoId, row.number],
    compare: compareByNumber,
  });
}

export async function listPullRequests(
  db: Database,
  repos: readonly ScopedRepo[],
  input: ListInput,
): Promise<Page<WorkPullRequest>> {
  if (repos.length === 0) return { items: [], nextCursor: null };
  const ids = repos.map((repo) => repo.id);
  const table = schema.workPullRequests;
  const rows = await db.select().from(table).where(inArray(table.repoId, ids));
  const reviewRows = await db
    .select({
      repoId: schema.workReviews.repoId,
      pullRequestNumber: schema.workReviews.pullRequestNumber,
      author: schema.workReviews.author,
      state: schema.workReviews.state,
    })
    .from(schema.workReviews)
    .where(inArray(schema.workReviews.repoId, ids));
  const counts = new Map<string, Map<string, ReviewCount>>();
  for (const review of reviewRows) {
    const pullKey = `${review.repoId}#${String(review.pullRequestNumber)}`;
    const group = counts.get(pullKey) ?? new Map<string, ReviewCount>();
    const key = JSON.stringify([review.author, review.state]);
    const entry = group.get(key) ?? { author: review.author, state: review.state, count: 0 };
    entry.count += 1;
    group.set(key, entry);
    counts.set(pullKey, group);
  }
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const isStale = newestListing(rows);
  const items = rows.map((row) => ({
    repoId: row.repoId,
    number: row.number,
    title: row.title,
    state: row.state,
    draft: row.draft,
    headBranch: row.headBranch,
    baseBranch: row.baseBranch,
    author: row.author,
    checks: row.checks,
    labels: row.labels,
    link: linkFor(row.link, byId.get(row.repoId)),
    reviews: [...(counts.get(`${row.repoId}#${String(row.number)}`)?.values() ?? [])].sort(
      (a, b) => byText(a.author, b.author) || byText(a.state, b.state),
    ),
    stale: isStale(row),
  }));
  items.sort((a, b) => compareByNumber([a.repoId, a.number], [b.repoId, b.number]));
  return paginate(items, {
    ...input,
    keyOf: (row) => [row.repoId, row.number],
    compare: compareByNumber,
  });
}

export async function listReleases(
  db: Database,
  repos: readonly ScopedRepo[],
  input: ListInput,
): Promise<Page<WorkRelease>> {
  if (repos.length === 0) return { items: [], nextCursor: null };
  const ids = repos.map((repo) => repo.id);
  const rows = await db
    .select()
    .from(schema.workReleases)
    .where(inArray(schema.workReleases.repoId, ids));
  const forgeRows = await db
    .select()
    .from(schema.workForgeReleases)
    .where(inArray(schema.workForgeReleases.repoId, ids));
  const forgeByKey = new Map(forgeRows.map((row) => [JSON.stringify([row.repoId, row.tag]), row]));
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const items = rows.map((row) => {
    const repo = byId.get(row.repoId);
    const forge = forgeByKey.get(JSON.stringify([row.repoId, row.name]));
    return {
      repoId: row.repoId,
      name: row.name,
      state: row.state,
      link: linkFor(row.link, repo),
      issueNumbers: row.issueNumbers,
      forgeRelease:
        row.state !== "released" || forge === undefined
          ? null
          : {
              tag: forge.tag,
              targetCommit: forge.targetCommit,
              assetNames: forge.assetNames,
              link: linkFor(forge.link, repo),
              noForgeRelease: forge.noForgeRelease,
            },
    };
  });
  items.sort((a, b) => compareByName([a.repoId, a.name], [b.repoId, b.name]));
  return paginate(items, {
    ...input,
    keyOf: (row) => [row.repoId, row.name],
    compare: compareByName,
  });
}
