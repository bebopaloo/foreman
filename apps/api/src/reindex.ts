import { createDatabase } from "@foreman/db";
import type { Database } from "@foreman/db";
import { loadConfig } from "./config.ts";
import { type IngestLog, ingestTranscripts, plural, withRefreshLock } from "./usage/ingest.ts";

export class RefreshRunningError extends Error {
  constructor() {
    super("A refresh is running.");
    this.name = "RefreshRunningError";
  }
}

export interface ReindexOptions {
  db: Database;
  claudeDir: string;
  dataDir: string;
  log: IngestLog;
}

/**
 * Reads all sources again and replaces the Usage index data with them in one
 * transaction. A failed write keeps the old data. It returns the counts.
 * It stops with a `RefreshRunningError` while a refresh holds the refresh lock.
 */
export async function runReindex(options: ReindexOptions): Promise<string> {
  const locked = await withRefreshLock(options.db, () =>
    ingestTranscripts({ ...options, replaceAll: true }),
  );
  if (!locked.ran) throw new RefreshRunningError();
  const result = locked.value;
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
    if (!(error instanceof RefreshRunningError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  await main();
}
