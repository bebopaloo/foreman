import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import { eq, sql } from "drizzle-orm";
import { type ParsedTurn, parseLine } from "./parse.ts";
import { readCompleteLines, scanSources } from "./sources.ts";

export interface IngestLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface IngestOptions {
  db: Database;
  claudeDir: string;
  dataDir: string;
  log: IngestLog;
  /** Delete all turns in the same transaction that writes the new turns. */
  replaceAll?: boolean;
}

export interface IngestResult {
  state: "idle";
  /** Files that the refresh read. */
  files: number;
  /** Distinct turns that the refresh read. */
  turns: number;
  skippedLines: number;
  unreadableFiles: number;
}

type IndexedTurn = ParsedTurn & { agentType: string };

// 15 columns for each row, and Postgres allows 65,535 parameters in a query.
const INSERT_BATCH_SIZE = 500;

const COUNT_COLUMNS = [
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["cache_write_5m_tokens", "cacheWrite5mTokens"],
  ["cache_write_1h_tokens", "cacheWrite1hTokens"],
  ["cache_read_tokens", "cacheReadTokens"],
  ["web_search_count", "webSearchCount"],
] as const;

function keepLargestCounts(known: IndexedTurn, next: IndexedTurn): IndexedTurn {
  const merged = { ...known };
  for (const [, field] of COUNT_COLUMNS) merged[field] = Math.max(known[field], next[field]);
  return merged;
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

async function writeTurns(db: Pick<Database, "insert">, turns: IndexedTurn[]): Promise<void> {
  for (let start = 0; start < turns.length; start += INSERT_BATCH_SIZE) {
    const batch = turns.slice(start, start + INSERT_BATCH_SIZE);
    await db
      .insert(schema.turns)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.turns.turnKey,
        set: {
          inputTokens: sql`greatest(${schema.turns.inputTokens}, excluded.input_tokens)`,
          outputTokens: sql`greatest(${schema.turns.outputTokens}, excluded.output_tokens)`,
          cacheWrite5mTokens: sql`greatest(${schema.turns.cacheWrite5mTokens}, excluded.cache_write_5m_tokens)`,
          cacheWrite1hTokens: sql`greatest(${schema.turns.cacheWrite1hTokens}, excluded.cache_write_1h_tokens)`,
          cacheReadTokens: sql`greatest(${schema.turns.cacheReadTokens}, excluded.cache_read_tokens)`,
          webSearchCount: sql`greatest(${schema.turns.webSearchCount}, excluded.web_search_count)`,
        },
      });
  }
}

async function readSources(
  options: IngestOptions,
): Promise<IngestResult & { rows: IndexedTurn[] }> {
  const { claudeDir, dataDir, log } = options;
  const scan = await scanSources(claudeDir, dataDir);
  for (const source of scan.missing) log.warn(`missing source: ${source}`);

  const byKey = new Map<string, IndexedTurn>();
  let files = 0;
  let skippedLines = 0;
  let unreadableFiles = 0;
  for (const file of scan.files) {
    let lines: string[];
    try {
      ({ lines } = await readCompleteLines(file.path));
    } catch {
      unreadableFiles += 1;
      log.warn(`unreadable file: ${file.path}`);
      continue;
    }
    files += 1;
    let skipped = 0;
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed.kind === "malformed") skipped += 1;
      if (parsed.kind !== "turn") continue;
      const next = { ...parsed.turn, agentType: file.agentType };
      const known = byKey.get(next.turnKey);
      byKey.set(next.turnKey, known ? keepLargestCounts(known, next) : next);
    }
    if (skipped > 0) log.warn(`skipped ${plural(skipped, "line")} in ${file.path}`);
    skippedLines += skipped;
  }
  const rows = [...byKey.values()];
  return { state: "idle", files, turns: rows.length, skippedLines, unreadableFiles, rows };
}

/**
 * One refresh: reads the live transcripts and writes their turns by turn key.
 * A re-read never deletes a turn. The log holds paths and counts only.
 */
export async function ingestTranscripts(options: IngestOptions): Promise<IngestResult> {
  const { db, log } = options;
  const [run] = await db
    .insert(schema.refreshRuns)
    .values({ startedAt: new Date(), state: "running" })
    .returning({ id: schema.refreshRuns.id });
  if (run === undefined) throw new Error("The refresh run was not recorded.");
  try {
    const { rows, ...result } = await readSources(options);
    await db.transaction(async (tx) => {
      if (options.replaceAll === true) await tx.delete(schema.turns);
      await writeTurns(tx, rows);
    });
    await db
      .update(schema.refreshRuns)
      .set({
        state: "idle",
        endedAt: new Date(),
        filesTotal: result.files + result.unreadableFiles,
        filesRead: result.files,
        turnsAdded: result.turns,
      })
      .where(eq(schema.refreshRuns.id, run.id));
    log.info(`refresh done: ${plural(result.files, "file")}, ${plural(result.turns, "turn")}`);
    return result;
  } catch (error) {
    await db
      .update(schema.refreshRuns)
      .set({ state: "failed", endedAt: new Date(), failureReason: "refresh failed" })
      .where(eq(schema.refreshRuns.id, run.id));
    throw error;
  }
}
