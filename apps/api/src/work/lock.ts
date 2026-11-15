import type { Database } from "@foreman/db";
import { sql } from "drizzle-orm";
import type { LockResult } from "../usage/ingest.ts";

// The key of the Postgres advisory lock that one fetch holds. It differs from the usage refresh lock.
const FETCH_LOCK_KEY = 5_011_002;

/**
 * Runs `fn` while it holds the fetch lock. The lock belongs to one open
 * transaction, so Postgres frees it when the process ends. When another fetch
 * holds the lock, `fn` does not run.
 */
export async function withFetchLock<T>(db: Database, fn: () => Promise<T>): Promise<LockResult<T>> {
  return db.transaction(async (tx): Promise<LockResult<T>> => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${FETCH_LOCK_KEY}) as locked`,
    );
    if (rows[0]?.locked !== true) return { ran: false };
    return { ran: true, value: await fn() };
  });
}
