import { chmod } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import {
  gateEvent,
  isoSeconds,
  makeFactoryDir,
  minutesAgo,
  nightLine,
  NOW,
  writeJsonl,
  writeLock,
} from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const TODAY = "2026-11-15";

async function dash(
  setup: (factory: string) => Promise<void> = () => Promise.resolve(),
  url = "/api/dash",
) {
  const { claudeDir, factory } = await makeFactoryDir();
  await setup(factory);
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
    db: database.db,
    logger: { level: "warn", stream },
    now: () => NOW,
  });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return { response, body: response.json<Record<string, unknown>>(), log: lines.join("") };
}

describe("GET /api/dash", () => {
  it("shows a run in progress with the heartbeat age", async () => {
    const { body } = await dash((factory) =>
      writeLock(factory, { run_id: "run-1", heartbeat: minutesAgo(4).getTime() / 1000 }),
    );
    expect(body.run).toEqual({
      state: "in_progress",
      stale: false,
      heartbeatAt: minutesAgo(4).toISOString(),
      heartbeatAgeSeconds: 240,
    });
  });

  it("shows no run and a stale flag for a heartbeat more than 3 hours ago", async () => {
    const { body } = await dash((factory) =>
      writeLock(factory, { run_id: "run-1", heartbeat: minutesAgo(181).getTime() / 1000 }),
    );
    expect(body.run).toMatchObject({ state: "none", stale: true });
  });

  it("shows no run when there is no lock and no folder", async () => {
    const { response, body } = await dash();
    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      run: { state: "none", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null },
      sources: { runs: "missing", controls: "missing" },
      skipped: { nightLogLines: 0, controlEvents: 0, files: 0, lock: 0 },
    });
  });

  it("counts an unreadable lock in skipped", async () => {
    const { body } = await dash((factory) => writeLock(factory, "{broken"));
    expect(body.run).toMatchObject({ state: "unreadable" });
    expect(body.skipped).toMatchObject({ lock: 1 });
  });

  it("counts skipped lines and logs the file name and the counts with no line content", async () => {
    const secret = "SECRET-LINE-CONTENT";
    const { body, log } = await dash(async (factory) => {
      await writeJsonl(
        factory,
        "runs",
        TODAY,
        [nightLine(), `{"oops": "${secret}"`, nightLine({ issue: 3 }), '{"run_id":"r'],
        { lineEnd: false },
      );
      await writeJsonl(factory, "controls", TODAY, [
        gateEvent(),
        { kind: "surprise", repo: "acme/app", time: isoSeconds(minutesAgo(5)), note: secret },
      ]);
    });
    expect(body.skipped).toEqual({ nightLogLines: 1, controlEvents: 1, files: 0, lock: 0 });
    expect(body.sources).toEqual({ runs: "ok", controls: "ok" });
    expect(log).toContain(`${TODAY}.jsonl`);
    expect(log).toContain('"skippedLines":1');
    expect(log).not.toContain(secret);
  });

  it("shows a folder that it cannot read", async () => {
    const { claudeDir, factory } = await makeFactoryDir();
    await writeJsonl(factory, "runs", TODAY, [nightLine()]);
    await chmod(path.join(factory, "runs"), 0o000);
    try {
      const app = await buildApp({
        config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
        db: database.db,
        logger: false,
        now: () => NOW,
      });
      const response = await app.inject({ method: "GET", url: "/api/dash" });
      await app.close();
      expect(response.json<{ sources: unknown }>().sources).toEqual({
        runs: "unreadable",
        controls: "missing",
      });
    } finally {
      await chmod(path.join(factory, "runs"), 0o755);
    }
  });

  it("shows a heartbeat in the future as now", async () => {
    const { body } = await dash((factory) =>
      writeLock(factory, { run_id: "run-1", heartbeat: NOW.getTime() / 1000 + 120 }),
    );
    expect(body.run).toMatchObject({ state: "in_progress", heartbeatAgeSeconds: 0 });
  });

  it("accepts a client and refuses an unknown query key or a bad client", async () => {
    expect((await dash(undefined, "/api/dash?client=acme")).response.statusCode).toBe(200);
    expect((await dash(undefined, "/api/dash?other=1")).response.statusCode).toBe(400);
    expect((await dash(undefined, "/api/dash?client=A%20B")).response.statusCode).toBe(400);
  });
});
