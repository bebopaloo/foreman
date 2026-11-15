import { type Database, schema } from "@foreman/db";
import { eq, max } from "drizzle-orm";
import {
  type IngestLog,
  type IngestOptions,
  type IngestResult,
  ingestTranscripts,
  withRefreshLock,
} from "./ingest.ts";

export interface RefreshStatus {
  state: "idle" | "running" | "failed";
  filesRead: number | null;
  filesTotal: number | null;
  dataAsOf: string | null;
  reason: string | null;
}

export interface RefresherOptions {
  db: Database;
  claudeDir: string;
  dataDir: string;
  log: IngestLog;
  /** The refresh itself. Tests pass a fake. */
  ingest?: (options: IngestOptions) => Promise<IngestResult>;
  intervalMs?: number;
}

export interface Refresher {
  trigger(): Promise<void>;
  status(): Promise<RefreshStatus>;
  start(): void;
  stop(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "57P01",
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

/** A short reason. It never holds the text of the error, which can hold record content. */
function failureReason(error: unknown): string {
  const code = errorCode(error);
  const unavailable = code !== undefined && (UNAVAILABLE_CODES.has(code) || code.startsWith("08"));
  return unavailable ? "The database is not available." : "The refresh failed.";
}

function later(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * The refresh schedule and the refresh state. One refresh runs at a time in
 * this process, and one at a time over all processes under the refresh lock.
 */
export function createRefresher(options: RefresherOptions): Refresher {
  const { db, claudeDir, dataDir, log } = options;
  const ingest = options.ingest ?? ingestTranscripts;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let current: Promise<void> | null = null;
  let state: RefreshStatus["state"] = "idle";
  let progress: { filesRead: number; filesTotal: number } | null = null;
  let reason: string | null = null;
  let lastGood: Date | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;

  async function run(): Promise<void> {
    const before = { state, reason };
    state = "running";
    progress = null;
    reason = null;
    try {
      const locked = await withRefreshLock(db, () =>
        ingest({
          db,
          claudeDir,
          dataDir,
          log,
          onProgress: (next) => {
            progress = next;
          },
        }),
      );
      if (!locked.ran) {
        log.info("refresh skipped: another refresh is running");
        state = before.state;
        reason = before.reason;
        return;
      }
      lastGood = new Date();
      state = "idle";
    } catch (error) {
      state = "failed";
      reason = failureReason(error);
      log.warn(`refresh failed: ${reason}`);
    } finally {
      progress = null;
    }
  }

  function trigger(): Promise<void> {
    if (current !== null) return current;
    const started = run().finally(() => {
      current = null;
    });
    current = started;
    return started;
  }

  async function dataAsOf(): Promise<Date | null> {
    try {
      const [row] = await db
        .select({ endedAt: max(schema.refreshRuns.endedAt) })
        .from(schema.refreshRuns)
        .where(eq(schema.refreshRuns.state, "idle"));
      lastGood = later(lastGood, row?.endedAt ?? null);
    } catch {
      // The database is not available: the last known time stays.
    }
    return lastGood;
  }

  /** The wait starts when a refresh ends, so two timer refreshes never overlap. */
  function schedule(immediate: boolean): void {
    timer = setTimeout(
      () => {
        void trigger().finally(() => {
          if (!stopped) schedule(false);
        });
      },
      immediate ? 0 : intervalMs,
    );
    timer.unref();
  }

  return {
    trigger,
    async status() {
      const asOf = await dataAsOf();
      return {
        state,
        filesRead: state === "running" ? (progress?.filesRead ?? 0) : null,
        filesTotal: state === "running" ? (progress?.filesTotal ?? null) : null,
        dataAsOf: asOf?.toISOString() ?? null,
        reason: state === "failed" ? reason : null,
      };
    },
    start() {
      if (timer !== null) return;
      stopped = false;
      schedule(true);
    },
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await current;
    },
  };
}
