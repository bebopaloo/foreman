import { schema, type Database } from "@foreman/db";
import { notInArray } from "drizzle-orm";
import { readRepoList, type RepoListProblem } from "./repo-list.ts";

export interface FetchResult {
  state: "idle";
  /** Why a fetch read no repo, or null. */
  reason: string | null;
  repos: number;
  problems: RepoListProblem[];
}

export interface FetchOptions {
  db: Database;
  claudeDir: string;
}

/**
 * The repo list part of a fetch. It writes the repos that the list names and
 * deletes the repos that a valid list no longer names. It never writes the list.
 */
export async function runFetch({ db, claudeDir }: FetchOptions): Promise<FetchResult> {
  const startedAt = new Date();
  const list = await readRepoList(claudeDir);

  let result: FetchResult;
  if (list.status !== "ok") {
    const reason = list.status === "missing" ? "no repo list" : "repo list not readable";
    result = { state: "idle", reason, repos: 0, problems: [] };
  } else {
    await db.transaction(async (tx) => {
      for (const repo of list.repos) {
        if (repo.owner === null || repo.name === null) continue;
        const values = {
          host: repo.host,
          owner: repo.owner,
          name: repo.name,
          client: repo.client,
          forgePlugin: repo.forge,
          trackerPlugin: repo.tracker,
        };
        await tx
          .insert(schema.workRepos)
          .values({ id: repo.id, ...values })
          .onConflictDoUpdate({ target: schema.workRepos.id, set: values });
      }
      if (list.identityUnknown) return;
      const named = [...list.namedIds];
      await (named.length === 0
        ? tx.delete(schema.workRepos)
        : tx.delete(schema.workRepos).where(notInArray(schema.workRepos.id, named)));
    });
    result = { state: "idle", reason: null, repos: list.repos.length, problems: list.problems };
  }

  await db.insert(schema.workFetchRuns).values({
    startedAt,
    endedAt: new Date(),
    kind: "incremental",
    state: result.state,
    reposRead: result.repos,
    failureReason: result.reason,
  });
  return result;
}
