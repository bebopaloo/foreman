import { schema } from "@foreman/db";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { ingestTranscripts } from "../src/usage/ingest.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { makeConfigFolder, recordingLog } from "./usage-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table turns, agents, projects, refresh_runs, file_cursors, limit_readings`,
  );
});

interface Reading {
  time: string;
  session?: string;
  fiveHour?: [number, string | number];
  sevenDay?: [number, string | number];
}

function captureLine(reading: Reading): string {
  const window = (value: [number, string | number]) => ({
    used_percentage: value[0],
    resets_at: value[1],
  });
  return JSON.stringify({
    time: reading.time,
    session_id: reading.session ?? "s1",
    rate_limits: {
      ...(reading.fiveHour ? { five_hour: window(reading.fiveHour) } : {}),
      ...(reading.sevenDay ? { seven_day: window(reading.sevenDay) } : {}),
    },
  });
}

async function writeCapture(dataDir: string, lines: string[]) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "limit-readings.jsonl"), `${lines.join("\n")}\n`);
}

async function refresh(folder: { claudeDir: string; dataDir: string }) {
  const { log, entries } = recordingLog();
  const result = await ingestTranscripts({ db: database.db, ...folder, log });
  return { result, entries };
}

async function getLimits(query = "from=2026-11-01&to=2026-11-30&tz=UTC") {
  const app = await buildApp({ config: testConfig, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url: `/api/usage/limits?${query}` });
  await app.close();
  return response;
}

describe("GET /api/usage/limits", () => {
  it("returns the peak of each past window and the latest reading of each window", async () => {
    const folder = await makeConfigFolder();
    await writeCapture(folder.dataDir, [
      captureLine({
        time: "2026-11-01T06:00:00Z",
        fiveHour: [10, "2026-11-01T10:00:00Z"],
        sevenDay: [20, "2026-11-08T00:00:00Z"],
      }),
      captureLine({
        time: "2026-11-01T08:00:00Z",
        fiveHour: [55.5, "2026-11-01T10:00:20Z"],
        sevenDay: [30, "2026-11-08T00:00:00Z"],
      }),
      captureLine({
        time: "2026-11-01T09:00:00Z",
        fiveHour: [40, "2026-11-01T10:00:00Z"],
        sevenDay: [35, 1794096020],
      }),
      captureLine({
        time: "2026-11-01T11:00:00Z",
        fiveHour: [5, "2026-11-01T15:00:00Z"],
        sevenDay: [36, "2026-11-08T00:00:00Z"],
      }),
    ]);
    await refresh(folder);

    const response = await getLimits();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      windows: [
        { window: "five_hour", resetsAt: "2026-11-01T10:00:00.000Z", peakUsedPercentage: 55.5 },
        { window: "five_hour", resetsAt: "2026-11-01T15:00:00.000Z", peakUsedPercentage: 5 },
        { window: "seven_day", resetsAt: "2026-11-08T00:00:00.000Z", peakUsedPercentage: 36 },
        { window: "seven_day", resetsAt: "2026-11-08T00:00:00.000Z", peakUsedPercentage: 36 },
      ].slice(0, 3),
      latest: {
        five_hour: {
          time: "2026-11-01T11:00:00.000Z",
          usedPercentage: 5,
          resetsAt: "2026-11-01T15:00:00.000Z",
        },
        seven_day: {
          time: "2026-11-01T11:00:00.000Z",
          usedPercentage: 36,
          resetsAt: "2026-11-08T00:00:00.000Z",
        },
      },
    });
  });

  it("leaves out a window that has not reset yet and a window outside the range", async () => {
    const folder = await makeConfigFolder();
    await writeCapture(folder.dataDir, [
      captureLine({ time: "2026-11-01T06:00:00Z", fiveHour: [10, "2026-11-01T10:00:00Z"] }),
      captureLine({ time: "2026-11-20T06:00:00Z", fiveHour: [20, "2026-11-20T10:00:00Z"] }),
      captureLine({ time: "2999-01-01T06:00:00Z", fiveHour: [30, "2999-01-01T10:00:00Z"] }),
    ]);
    await refresh(folder);

    const response = await getLimits("from=2026-11-01&to=2026-11-10&tz=UTC");

    expect(response.json<{ windows: unknown[] }>().windows).toEqual([
      { window: "five_hour", resetsAt: "2026-11-01T10:00:00.000Z", peakUsedPercentage: 10 },
    ]);
    expect(
      response.json<{ latest: { five_hour: { usedPercentage: number } } }>().latest,
    ).toMatchObject({
      five_hour: { usedPercentage: 30 },
    });
  });

  it("dates a window by its reset time in the time zone of the request", async () => {
    const folder = await makeConfigFolder();
    await writeCapture(folder.dataDir, [
      captureLine({ time: "2026-11-01T20:00:00Z", fiveHour: [10, "2026-11-02T01:00:00Z"] }),
    ]);
    await refresh(folder);

    const utc = await getLimits("from=2026-11-02&to=2026-11-02&tz=UTC");
    const newYork = await getLimits("from=2026-11-02&to=2026-11-02&tz=America/New_York");

    expect(utc.json<{ windows: unknown[] }>().windows).toHaveLength(1);
    expect(newYork.json<{ windows: unknown[] }>().windows).toHaveLength(0);
  });

  it("returns no windows and no latest reading when there is no capture file", async () => {
    const folder = await makeConfigFolder();

    const { result } = await refresh(folder);
    const response = await getLimits();

    expect(result.state).toBe("idle");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      windows: [],
      latest: { five_hour: null, seven_day: null },
    });
  });

  it("rejects an unknown time zone, a reversed range and an unknown field", async () => {
    expect((await getLimits("from=2026-11-01&to=2026-11-02&tz=Nowhere/City")).statusCode).toBe(400);
    expect((await getLimits("from=2026-11-03&to=2026-11-02&tz=UTC")).statusCode).toBe(400);
    expect((await getLimits("from=2026-11-01&to=2026-11-02&tz=UTC&x=1")).statusCode).toBe(400);
  });
});

describe("limit readings ingest", () => {
  it("skips a malformed line, counts it, and keeps a line with no rate limits out of the count", async () => {
    const folder = await makeConfigFolder();
    await writeCapture(folder.dataDir, [
      "{broken",
      JSON.stringify({ time: "2026-11-01T06:00:00Z", session_id: "s1" }),
      captureLine({ time: "2026-11-01T07:00:00Z", fiveHour: [10, "2026-11-01T10:00:00Z"] }),
    ]);

    const { result, entries } = await refresh(folder);

    expect(result.skippedLines).toBe(1);
    expect(entries.map((entry) => entry.message)).toContain(
      `skipped 1 line in ${folder.dataDir}/limit-readings.jsonl`,
    );
    expect(await database.db.select().from(schema.limitReadings)).toHaveLength(1);
  });

  it("reads only the new lines of the capture file on a later refresh", async () => {
    const folder = await makeConfigFolder();
    const first = captureLine({
      time: "2026-11-01T07:00:00Z",
      fiveHour: [10, "2026-11-01T10:00:00Z"],
    });
    await writeCapture(folder.dataDir, [first]);
    await refresh(folder);
    await writeCapture(folder.dataDir, [
      first,
      captureLine({ time: "2026-11-01T08:00:00Z", fiveHour: [20, "2026-11-01T10:00:00Z"] }),
    ]);

    const { entries } = await refresh(folder);

    expect(entries.map((entry) => entry.message)).toContain(
      `read 1 new line in ${folder.dataDir}/limit-readings.jsonl`,
    );
    expect(await database.db.select().from(schema.limitReadings)).toHaveLength(2);
  });

  it("does not fail the refresh when the capture file cannot be read", async () => {
    const folder = await makeConfigFolder();
    await mkdir(path.join(folder.dataDir, "limit-readings.jsonl"), { recursive: true });

    const { result, entries } = await refresh(folder);

    expect(result.state).toBe("idle");
    expect(result.unreadableFiles).toBe(1);
    expect(entries.map((entry) => entry.message)).toContain(
      `unreadable file: ${folder.dataDir}/limit-readings.jsonl`,
    );
  });

  it("replaces the readings on a full reindex", async () => {
    const folder = await makeConfigFolder();
    await writeCapture(folder.dataDir, [
      captureLine({ time: "2026-11-01T07:00:00Z", fiveHour: [10, "2026-11-01T10:00:00Z"] }),
    ]);
    await refresh(folder);
    await writeCapture(folder.dataDir, [
      captureLine({ time: "2026-11-01T09:00:00Z", fiveHour: [30, "2026-11-01T10:00:00Z"] }),
    ]);

    await ingestTranscripts({
      db: database.db,
      ...folder,
      log: recordingLog().log,
      replaceAll: true,
    });

    const rows = await database.db.select().from(schema.limitReadings);
    expect(rows.map((row) => row.usedPercentage)).toEqual([30]);
  });
});
