import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestOptions, IngestResult } from "../src/usage/ingest.ts";
import { withRefreshLock } from "../src/usage/ingest.ts";
import { createRefresher } from "../src/usage/refresh.ts";
import { openTestDatabase } from "./database.ts";
import { recordingLog } from "./usage-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table turns, agents, projects, refresh_runs, file_cursors, skill_calls, agent_starts`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const RESULT: IngestResult = {
  state: "idle",
  files: 1,
  turns: 1,
  skippedLines: 0,
  unreadableFiles: 0,
};

/** A fake refresh that waits until the test lets it end. */
function controlledIngest() {
  const calls: IngestOptions[] = [];
  const pending: { finish: () => void; fail: (error: unknown) => void }[] = [];
  const ingest = (options: IngestOptions) => {
    calls.push(options);
    return new Promise<IngestResult>((resolve, reject) => {
      pending.push({
        finish: () => {
          resolve(RESULT);
        },
        fail: reject,
      });
    });
  };
  return { calls, pending, ingest };
}

function makeRefresher(
  ingest: (options: IngestOptions) => Promise<IngestResult>,
  extra: { intervalMs?: number } = {},
) {
  return createRefresher({
    db: database.db,
    claudeDir: "/synthetic/claude",
    dataDir: "/synthetic/data",
    log: recordingLog().log,
    ingest,
    ...extra,
  });
}

describe("createRefresher", () => {
  it("runs one refresh at a time", async () => {
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest);

    const first = refresher.trigger();
    const second = refresher.trigger();
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(1);
    });
    fake.pending[0]?.finish();
    await Promise.all([first, second]);

    expect(fake.calls).toHaveLength(1);
  });

  it("skips the refresh while another process holds the refresh lock", async () => {
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const other = withRefreshLock(database.db, async () => {
      entered();
      await held;
    });
    await inside;

    try {
      await refresher.trigger();
    } finally {
      release();
      await other;
    }

    expect(fake.calls).toHaveLength(0);
    expect((await refresher.status()).state).toBe("idle");
  });

  it("shows the files read and the total while it runs, then idle with the data as of time", async () => {
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest);

    const run = refresher.trigger();
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(1);
    });
    fake.calls[0]?.onProgress?.({ filesRead: 1240, filesTotal: 3100 });
    const during = await refresher.status();
    fake.pending[0]?.finish();
    await run;
    const after = await refresher.status();

    expect(during).toMatchObject({
      state: "running",
      filesRead: 1240,
      filesTotal: 3100,
      dataAsOf: null,
    });
    expect(after.state).toBe("idle");
    expect(after.filesRead).toBeNull();
    expect(Date.parse(after.dataAsOf ?? "")).toBeGreaterThan(Date.now() - 60_000);
  });

  it("shows a short reason when the database is not available, and keeps the data as of time", async () => {
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest);
    const good = refresher.trigger();
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(1);
    });
    fake.pending[0]?.finish();
    await good;
    const goodStatus = await refresher.status();

    const bad = refresher.trigger();
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(2);
    });
    fake.pending[1]?.fail(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1 SECRET-RECORD-TEXT"), {
        code: "ECONNREFUSED",
      }),
    );
    await bad;
    const status = await refresher.status();

    expect(status).toEqual({
      state: "failed",
      filesRead: null,
      filesTotal: null,
      dataAsOf: goodStatus.dataAsOf,
      reason: "The database is not available.",
    });
  });

  it("runs a refresh at start and each 15 minutes, and stops the timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let calls = 0;
    const refresher = makeRefresher(() => {
      calls += 1;
      return Promise.resolve(RESULT);
    });

    refresher.start();
    await vi.waitFor(() => {
      expect(calls).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(calls).toBe(2);
    });
    await refresher.stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(calls).toBe(2);
  });

  it("waits the interval after the end of the last refresh", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest, { intervalMs: 1000 });

    refresher.start();
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(1);
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    fake.pending[0]?.finish();
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(fake.calls).toHaveLength(2);
    });
    fake.pending[1]?.finish();
    await refresher.stop();
  });

  it("skips the timer refresh while another process holds the refresh lock", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = controlledIngest();
    const refresher = makeRefresher(fake.ingest, { intervalMs: 1000 });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const other = withRefreshLock(database.db, async () => {
      entered();
      await held;
    });
    await inside;

    try {
      refresher.start();
      await vi.advanceTimersByTimeAsync(3500);
      await refresher.stop();
    } finally {
      release();
      await other;
    }

    expect(fake.calls).toHaveLength(0);
  });
});
