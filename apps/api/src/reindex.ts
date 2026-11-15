import { createDatabase, schema } from "@foreman/db";
import type { Database } from "@foreman/db";
import { loadConfig } from "./config.ts";
import { withFetchLock } from "./work/lock.ts";
import { type IngestLog, ingestTranscripts, plural, withRefreshLock } from "./usage/ingest.ts";

export class RefreshRunningError extends Error {
  constructor() {
    super("A refresh is running.");
    this.name = "RefreshRunningError";
  }
}

export class FetchRunningError extends Error {
  constructor() {
    super("A fetch is running.");
    this.name = "FetchRunningError";
  }
}

export interface ReindexOptions {
  db: Database;
  claudeDir: string;
  dataDir: string;
  log: IngestLog;
}

/** The tables of the work cache. The next fetch has no earlier full fetch, so it is a full fetch. */
const WORK_TABLES = [
  schema.workIssues,
  schema.workPullRequests,
  schema.workReviews,
  schema.workReleases,
  schema.workForgeReleases,
  schema.workFetchRuns,
  schema.workRepos,
] as const;

/**
 * Reads all sources again and replaces the Usage index data with them in one
 * transaction, then empties the work cache. A failed write keeps the old data.
 * It returns the counts. It stops with a `RefreshRunningError` while a refresh
 * holds the refresh lock, and with a `FetchRunningError` while a fetch holds the fetch lock.
 */
export async function runReindex(options: ReindexOptions): Promise<string> {
  const fetchLocked = await withFetchLock(options.db, async () => {
    const locked = await withRefreshLock(options.db, () =>
      ingestTranscripts({ ...options, replaceAll: true }),
    );
    if (!locked.ran) throw new RefreshRunningError();
    await options.db.transaction(async (tx) => {
      for (const table of WORK_TABLES) await tx.delete(table);
    });
    return locked.value;
  });
  if (!fetchLocked.ran) throw new FetchRunningError();
  const result = fetchLocked.value;
  return `Reindex done: ${plural(result.files, "file")}, ${plural(result.turns, "turn")}.`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL);
  try {
    const summary = await runReindex({
      db: database.db,
      claudeDir: config.FOREMAN_CLAUDE_DIR,
      dataDir: config.FOREMAN_DATA_DIR,
      log: {
        info: (message) => {
          console.log(message);
        },
        warn: (message) => {
          console.warn(message);
        },
      },
    });
    console.log(summary);
  } catch (error) {
    if (!(error instanceof RefreshRunningError || error instanceof FetchRunningError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  await main();
}
