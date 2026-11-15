import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withFetchLock } from "../src/work/lock.ts";
import { createFetchSchedule, type FetchScheduleOptions } from "../src/work/schedule.ts";
import { openTestDatabase } from "./database.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch that ends when the test calls `finish`, or fails when it calls `fail`. */
function controlledFetch() {
  const seen = { starts: 0 };
  const waiting: { finish: () => void; fail: () => void }[] = [];
  const fetch: NonNullable<FetchScheduleOptions["fetch"]> = () => {
    seen.starts += 1;
    return new Promise((resolve, reject) => {
      waiting.push({
        finish: () => {
          resolve(undefined);
        },
        fail: () => {
          reject(new Error("secret"));
        },
      });
    });
  };
  return { seen, fetch, current: () => waiting[waiting.length - 1] };
}

function scheduleWith(fetch: FetchScheduleOptions["fetch"], intervalMs = 15 * 60_000) {
  const logs: string[] = [];
  const schedule = createFetchSchedule({
    db: database.db,
    claudeDir: "/synthetic/claude",
    intervalMs,
    log: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    ...(fetch === undefined ? {} : { fetch }),
  });
  return { schedule, logs };
}

describe("the fetch schedule", () => {
  it("runs one fetch at a time and gives the fetch in progress to a second trigger", async () => {
    const control = controlledFetch();
    const { schedule } = scheduleWith(control.fetch);

    const first = schedule.trigger();
    const second = schedule.trigger();
    await vi.waitFor(() => {
      expect(control.seen.starts).toBe(1);
    });

    expect(schedule.state()).toEqual({ state: "running", reason: null });
    expect(second).toBe(first);
    control.current()?.finish();
    await first;
    expect(control.seen.starts).toBe(1);
    expect(schedule.state()).toEqual({ state: "idle", reason: null });
  });

  it("fetches on start and each interval, and skips the timer while a fetch runs", async () => {
    const control = controlledFetch();
    const { schedule } = scheduleWith(control.fetch, 1000);

    schedule.start();
    await vi.waitFor(() => {
      expect(control.seen.starts).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.seen.starts).toBe(1);

    control.current()?.finish();
    await vi.waitFor(() => {
      expect(schedule.state().state).toBe("idle");
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(control.seen.starts).toBe(2);
    });

    control.current()?.finish();
    await schedule.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(control.seen.starts).toBe(2);
  });

  it("shows a failed fetch with a short reason that holds no error text, and recovers", async () => {
    const control = controlledFetch();
    const { schedule, logs } = scheduleWith(control.fetch);

    const failing = schedule.trigger();
    await vi.waitFor(() => {
      expect(control.seen.starts).toBe(1);
    });
    control.current()?.fail();
    await failing;

    expect(schedule.state()).toEqual({ state: "failed", reason: "The fetch failed." });
    expect(logs.join("\n")).not.toContain("secret");

    const next = schedule.trigger();
    await vi.waitFor(() => {
      expect(control.seen.starts).toBe(2);
    });
    control.current()?.finish();
    await next;
    expect(schedule.state()).toEqual({ state: "idle", reason: null });
  });

  it("skips a fetch while another process holds the fetch lock", async () => {
    const control = controlledFetch();
    const { schedule, logs } = scheduleWith(control.fetch);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withFetchLock(database.db, () => held);
    await vi.waitFor(async () => {
      const probe = await withFetchLock(database.db, () => Promise.resolve(1));
      expect(probe.ran).toBe(false);
    });

    await schedule.trigger();
    release();
    await holder;

    expect(control.seen.starts).toBe(0);
    expect(logs).toContain("fetch skipped: another fetch is running");
    expect(schedule.state().state).toBe("idle");
    await database.db.execute(sql`select 1`);
  });

  it("runs a real fetch with no repo list and ends idle", async () => {
    const { schedule } = scheduleWith(undefined);
    await schedule.trigger();
    expect(schedule.state()).toEqual({ state: "idle", reason: null });
  });
});
