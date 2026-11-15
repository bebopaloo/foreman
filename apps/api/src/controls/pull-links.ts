import { schema, type Database } from "@foreman/db";
import { and, inArray } from "drizzle-orm";
import { linkFor } from "../work/lists.ts";
import type { ScopedRepo } from "../work/scope.ts";

export interface PullLink {
  number: number;
  link: string | null;
}

/** The key of a pull request in the maps of this folder. */
export const pullKey = (repoId: string, number: number): string => `${repoId}#${number.toString()}`;

/**
 * The link of each wanted pull request that the Work cache holds. A pull request that the cache
 * does not hold gets no link. The link check runs again against the host of the repo.
 */
export async function readPullLinks(
  db: Database,
  repos: readonly ScopedRepo[],
  wanted: readonly { repoId: string; number: number }[],
): Promise<Map<string, string | null>> {
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const numbers = [...new Set(wanted.map((item) => item.number))];
  const result = new Map<string, string | null>();
  if (byId.size === 0 || numbers.length === 0) return result;
  const rows = await db
    .select({
      repoId: schema.workPullRequests.repoId,
      number: schema.workPullRequests.number,
      link: schema.workPullRequests.link,
    })
    .from(schema.workPullRequests)
    .where(
      and(
        inArray(schema.workPullRequests.repoId, [...byId.keys()]),
        inArray(schema.workPullRequests.number, numbers),
      ),
    );
  for (const row of rows) {
    result.set(pullKey(row.repoId, row.number), linkFor(row.link, byId.get(row.repoId)));
  }
  return result;
}
