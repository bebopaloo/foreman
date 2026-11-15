import type { Database } from "@foreman/db";
import { runFetch, type FetchOptions } from "./fetch.ts";
import { withFetchLock } from "./lock.ts";

export interface FetchState {
  state: "idle" | "running" | "failed";
  /** A short reason of a failed fetch, or null. */
  reason: string | null;
}

export interface FetchScheduleOptions {
  db: Database;
  claudeDir: string;
  tokensFile?: string;
  allowedHosts?: readonly string[];
  timeoutMs?: number;
  intervalMs: number;
  log: { info(message: string): void; warn(message: string): void };
  /** The fetch itself. Tests pass a fake. */
  fetch?: (options: FetchOptions) => Promise<unknown>;
}

export interface FetchSchedule {
  /** Starts a fetch, or returns the fetch in progress. */
  trigger(): Promise<void>;
  state(): FetchState;
  start(): void;
  stop(): Promise<void>;
}

/** The text of the error can hold record content: the reason never uses it. */
const FAILURE_REASON = "The fetch failed.";

/**
 * The fetch schedule and the fetch state. One fetch runs at a time in this
 * process, and one at a time over all processes under the fetch lock.
 */
export function createFetchSchedule(options: FetchScheduleOptions): FetchSchedule {
  const { db, claudeDir, log } = options;
  const fetchWork = options.fetch ?? runFetch;
  let current: Promise<void> | null = null;
  let failed = false;
  let timer: NodeJS.Timeout | null = null;

  async function run(): Promise<void> {
    try {
      const locked = await withFetchLock(db, () =>
        fetchWork({
          db,
          claudeDir,
          log,
          ...(options.tokensFile === undefined ? {} : { tokensFile: options.tokensFile }),
          ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        }),
      );
      if (!locked.ran) {
        log.info("fetch skipped: another fetch is running");
        return;
      }
      failed = false;
    } catch {
      failed = true;
      log.warn(`fetch failed: ${FAILURE_REASON}`);
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

  return {
    trigger,
    state() {
      if (current !== null) return { state: "running", reason: null };
      return failed ? { state: "failed", reason: FAILURE_REASON } : { state: "idle", reason: null };
    },
    start() {
      if (timer !== null) return;
      void trigger();
      timer = setInterval(() => void trigger(), options.intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      await current;
    },
  };
}
