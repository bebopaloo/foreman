import { schema, type Database } from "@foreman/db";
import { desc, eq, notInArray } from "drizzle-orm";
import { fetchRepo, type RoleOutcome } from "./fetch-repo.ts";
import { readRepoList, type RepoListProblem } from "./repo-list.ts";
import { DEFAULT_TIMEOUT_MS } from "./runner.ts";
import { readTokens } from "./tokens.ts";

const FULL_FETCH_AFTER_MS = 24 * 60 * 60 * 1000;

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
  /** The tokens file. With no file, every repo is "not connected: no token". */
  tokensFile?: string;
  /** The hosts that an adapter may call, in lower case. */
  allowedHosts?: readonly string[];
  timeoutMs?: number;
  log?: { warn(message: string): void; info?(message: string): void };
  now?: () => Date;
}

/** The tables that hold the rows of one repo, apart from `work_repos`. */
const REPO_TABLES = [
  schema.workIssues,
  schema.workPullRequests,
  schema.workReviews,
  schema.workCommitStatuses,
  schema.workReleases,
  schema.workForgeReleases,
] as const;

/**
 * The repo list part of a fetch. It writes the repos that the list names and
 * deletes the repos that a valid list no longer names. It never writes the list.
 */
export async function runFetch(options: FetchOptions): Promise<FetchResult> {
  const { db, claudeDir } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const clockStart = performance.now();
  const list = await readRepoList(claudeDir);

  let result: FetchResult;
  let kind: "full" | "incremental" = "incremental";
  let adapterCalls = 0;
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
      for (const table of REPO_TABLES) {
        await (named.length === 0
          ? tx.delete(table)
          : tx.delete(table).where(notInArray(table.repoId, named)));
      }
    });

    const [lastFull] = await db
      .select({ startedAt: schema.workFetchRuns.startedAt })
      .from(schema.workFetchRuns)
      .where(eq(schema.workFetchRuns.kind, "full"))
      .orderBy(desc(schema.workFetchRuns.startedAt))
      .limit(1);
    const full =
      lastFull === undefined ||
      startedAt.getTime() - lastFull.startedAt.getTime() > FULL_FETCH_AFTER_MS;
    kind = full ? "full" : "incremental";

    const tokens = await readTokens(options.tokensFile);
    const runner = {
      allowedHosts: options.allowedHosts ?? [],
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.log === undefined ? {} : { log: options.log }),
    };
    for (const repo of list.repos) {
      if (repo.owner === null || repo.name === null) continue;
      const outcome = await fetchRepo(
        { db, claudeDir, tokens, runner, startedAt, full },
        { ...repo, owner: repo.owner, name: repo.name },
      );
      adapterCalls += outcome.calls;
      options.log?.info?.(
        `fetched ${repo.id}: calls=${String(outcome.calls)} forge_error=${outcome.forge.errorClass ?? "none"} tracker_error=${outcome.tracker.errorClass ?? "none"}`,
      );
      await writeRepoOutcome(db, repo.id, outcome.forge, outcome.tracker, now());
    }
    result = { state: "idle", reason: null, repos: list.repos.length, problems: list.problems };
  }

  options.log?.info?.(
    `fetch ended: kind=${kind} repos=${String(result.repos)} calls=${String(adapterCalls)} durationMs=${String(Math.round(performance.now() - clockStart))}`,
  );
  await db.insert(schema.workFetchRuns).values({
    startedAt,
    endedAt: new Date(),
    kind,
    state: result.state,
    reposRead: result.repos,
    adapterCalls,
    failureReason: result.reason,
  });
  return result;
}

async function writeRepoOutcome(
  db: FetchOptions["db"],
  repoId: string,
  forge: RoleOutcome,
  tracker: RoleOutcome,
  endedAt: Date,
): Promise<void> {
  // The "data as of" time moves only when no role had an error.
  const good = forge.clean && tracker.clean;
  await db
    .update(schema.workRepos)
    .set({
      forgeState: forge.state,
      forgeErrorClass: forge.errorClass,
      trackerState: tracker.state,
      trackerErrorClass: tracker.errorClass,
      ...(good ? { lastGoodFetchAt: endedAt } : {}),
    })
    .where(eq(schema.workRepos.id, repoId));
}
