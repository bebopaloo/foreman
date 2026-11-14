import { createDatabase } from "@foreman/db";
import type { Database } from "@foreman/db";
import { loadConfig } from "./config.ts";
import { type IngestLog, ingestTranscripts, plural } from "./usage/ingest.ts";

export interface ReindexOptions {
  db: Database;
  claudeDir: string;
  dataDir: string;
  log: IngestLog;
}

/**
 * Reads all sources again and replaces the Usage index data with them in one
 * transaction. A failed write keeps the old data. It returns the counts.
 */
export async function runReindex(options: ReindexOptions): Promise<string> {
  const result = await ingestTranscripts({ ...options, replaceAll: true });
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
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  await main();
}
