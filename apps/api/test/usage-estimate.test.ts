import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { syntheticTable } from "./price-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table turns, projects, refresh_runs, skill_calls`);
});

interface Seed {
  time?: string;
  model?: string;
  speed?: string | null;
  tier?: string | null;
  input?: number;
  output?: number;
  write5m?: number;
  write1h?: number;
  read?: number;
  searches?: number;
}

let counter = 0;
async function seed(rows: Seed[]) {
  await database.db
    .insert(schema.projects)
    .values({ projectKey: "/synthetic/a/app", noRepo: false })
    .onConflictDoNothing();
  for (const row of rows) {
    counter += 1;
    await database.db.insert(schema.turns).values({
      turnKey: `e${String(counter)}`,
      sessionId: "s1",
      time: new Date(row.time ?? "2026-11-01T10:00:00.000Z"),
      model: row.model ?? "claude-synthetic-1",
      speed: row.speed ?? null,
      serviceTier: row.tier ?? null,
      inputTokens: row.input ?? 0,
      outputTokens: row.output ?? 0,
      cacheWrite5mTokens: row.write5m ?? 0,
      cacheWrite1hTokens: row.write1h ?? 0,
      cacheReadTokens: row.read ?? 0,
      webSearchCount: row.searches ?? 0,
      projectKey: "/synthetic/a/app",
      branch: "main",
      agentType: "main",
    });
  }
}

async function tableFile(table: unknown): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "foreman-estimate-"));
  const file = path.join(folder, "price-table.json");
  await writeFile(file, JSON.stringify(table));
  return file;
}

/** Each call is a new API start, so it reads the price table again. */
async function get(url: string, priceTable: unknown = syntheticTable) {
  const config = { ...testConfig, FOREMAN_PRICE_TABLE: await tableFile(priceTable) };
  const app = await buildApp({ config, db: database.db, logger: false });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

const range = "from=2026-11-01&to=2026-11-03&tz=UTC";
const NOTE =
  "List-price estimate: what this usage costs at the public API prices. It is not what your subscription charges.";

interface Row {
  key: string;
  estimate: number | null;
  unpricedTurns: number;
}

describe("the list-price estimate", () => {
  it("follows the Spec rules and shows a fast turn in its own model row", async () => {
    await seed([
      {
        input: 1_000_000,
        output: 1_000_000,
        write5m: 1_000_000,
        write1h: 1_000_000,
        read: 1_000_000,
        searches: 1000,
      },
      { speed: "fast", input: 1_000_000, output: 1_000_000 },
    ]);

    const response = await get(`/api/usage/breakdown?dimension=model&${range}`);

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      rows: Row[];
      totals: Row;
      unpricedModels: unknown[];
      note: string;
    }>();
    // 3 + 15 + 3.75 + 6 + 0.3 + 10 = 38.05, and the fast turn 6 + 30
    expect(body.rows.map((row) => row.key)).toEqual([
      "claude-synthetic-1",
      "claude-synthetic-1 (fast)",
    ]);
    expect(body.rows[0]?.estimate).toBeCloseTo(38.05, 6);
    expect(body.rows[1]?.estimate).toBeCloseTo(36, 6);
    expect(body.totals.estimate).toBeCloseTo(74.05, 6);
    expect(body.unpricedModels).toEqual([]);
    expect(body.note).toBe(NOTE);
  });

  it("adds the estimate to the series, with null in a bucket of unpriced turns only", async () => {
    await seed([
      { time: "2026-11-01T10:00:00.000Z", input: 1_000_000 },
      { time: "2026-11-03T10:00:00.000Z", model: "other-model", input: 5 },
    ]);

    const response = await get(`/api/usage/series?grain=day&${range}`);

    const body = response.json<{ buckets: Row[]; unpricedModels: unknown[]; note: string }>();
    expect(body.buckets.map((b) => [b.estimate, b.unpricedTurns])).toEqual([
      [3, 0],
      [0, 0],
      [null, 1],
    ]);
    expect(body.unpricedModels).toEqual([{ model: "other-model", turns: 1 }]);
    expect(body.note).toBe(NOTE);
  });

  it("counts the turns of an unknown model for tokens and turns but not for the estimate", async () => {
    await seed([
      { model: "unknown-model", input: 10 },
      { model: "unknown-model", input: 10 },
      { model: "unknown-model", input: 10 },
    ]);

    const response = await get(`/api/usage/breakdown?dimension=model&${range}`);

    expect(response.json()).toMatchObject({
      rows: [{ key: "unknown-model", inputTokens: 30, turns: 3, estimate: null, unpricedTurns: 3 }],
      totals: { turns: 3, estimate: null, unpricedTurns: 3 },
      unpricedModels: [{ model: "unknown-model", turns: 3 }],
    });
  });

  describe("a priced and an unpriced model in one session and one day", () => {
    const mixed: Seed[] = [
      { time: "2026-11-01T09:00:00.000Z", model: "unknown-model", input: 7 },
      { time: "2026-11-01T10:00:00.000Z", input: 1_000_000 },
      { time: "2026-11-01T11:00:00.000Z", input: 1_000_000 },
      { time: "2026-11-01T12:00:00.000Z", model: "unknown-model", input: 7 },
    ];

    it("merges both into one session row and one totals row", async () => {
      await seed(mixed);

      const response = await get(`/api/usage/breakdown?dimension=session&${range}`);

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        rows: (Row & { turns: number; firstTurnAt: string; lastTurnAt: string })[];
        totals: Row & { turns: number };
        unpricedModels: unknown[];
      }>();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        key: "s1",
        turns: 4,
        estimate: 6,
        unpricedTurns: 2,
        firstTurnAt: "2026-11-01T09:00:00.000Z",
        lastTurnAt: "2026-11-01T12:00:00.000Z",
      });
      expect(body.totals).toMatchObject({ turns: 4, estimate: 6, unpricedTurns: 2 });
      expect(body.unpricedModels).toEqual([{ model: "unknown-model", turns: 2 }]);
    });

    it("merges both into one series bucket", async () => {
      await seed(mixed);

      const response = await get(`/api/usage/series?grain=day&${range}`);

      const body = response.json<{ buckets: (Row & { turns: number })[] }>();
      expect(body.buckets.map((b) => [b.turns, b.estimate, b.unpricedTurns])).toEqual([
        [4, 6, 2],
        [0, 0, 0],
        [0, 0, 0],
      ]);
    });
  });

  it("uses a changed rate for all history when the API starts again", async () => {
    await seed([{ input: 1_000_000 }]);
    const url = `/api/usage/breakdown?dimension=model&${range}`;
    const dearer = {
      ...syntheticTable,
      models: [{ ...syntheticTable.models[0], input_per_mtok: 4 }],
    };

    const before = await get(url);
    const after = await get(url, dearer);

    expect(before.json<{ totals: Row }>().totals.estimate).toBe(3);
    expect(after.json<{ totals: Row }>().totals.estimate).toBe(4);
  });

  it("does not start the API with an invalid price table", async () => {
    const config = {
      ...testConfig,
      FOREMAN_PRICE_TABLE: await tableFile({ models: [{ model: "x" }], rules: null }),
    };
    await expect(buildApp({ config, db: database.db, logger: false })).rejects.toThrow(
      /price table/i,
    );
  });
});
