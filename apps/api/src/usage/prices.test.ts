import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticTable } from "../../test/price-fixtures.ts";
import { estimateGroup, findRow, loadPriceTable, parsePriceTable } from "./prices.ts";

describe("parsePriceTable", () => {
  it("accepts a valid table", () => {
    expect(parsePriceTable(syntheticTable).models).toHaveLength(1);
  });

  it("accepts an empty table with no rules", () => {
    expect(parsePriceTable({ models: [], rules: null }).models).toEqual([]);
  });

  it("rejects a row with no source URL", () => {
    const row = { ...syntheticTable.models[0], source_url: undefined };
    expect(() => parsePriceTable({ ...syntheticTable, models: [row] })).toThrow(/price table/i);
  });

  it("rejects a negative rate, an unknown field and a bad date", () => {
    const row = syntheticTable.models[0];
    expect(() =>
      parsePriceTable({ ...syntheticTable, models: [{ ...row, input_per_mtok: -1 }] }),
    ).toThrow(/price table/i);
    expect(() => parsePriceTable({ ...syntheticTable, models: [{ ...row, extra: 1 }] })).toThrow(
      /price table/i,
    );
    expect(() =>
      parsePriceTable({ ...syntheticTable, models: [{ ...row, as_of: "yesterday" }] }),
    ).toThrow(/price table/i);
  });

  it("rejects rows with no rules", () => {
    expect(() => parsePriceTable({ ...syntheticTable, rules: null })).toThrow(/price table/i);
  });
});

describe("loadPriceTable", () => {
  it("accepts the price table of the repo", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "..",
      "data",
      "price-table.json",
    );
    await expect(loadPriceTable(file)).resolves.toBeDefined();
  });

  it("stops with a message that names the file when the file is not valid JSON", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "foreman-prices-"));
    const file = path.join(folder, "price-table.json");
    await writeFile(file, "{not json");
    await expect(loadPriceTable(file)).rejects.toThrow(file);
  });

  it("reads a valid file", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "foreman-prices-"));
    const file = path.join(folder, "price-table.json");
    await writeFile(file, JSON.stringify(syntheticTable));
    expect((await loadPriceTable(file)).models[0]?.model).toBe("claude-synthetic-1");
  });
});

const turn = {
  model: "claude-synthetic-1",
  speed: null,
  serviceTier: null,
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  webSearchCount: 0,
  turns: 1,
};

describe("estimateGroup", () => {
  const table = parsePriceTable(syntheticTable);

  it("prices input and output by the rate for each million tokens", () => {
    const result = estimateGroup(table, {
      ...turn,
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
    });
    expect(result).toEqual({ estimate: 3 + 30, unpricedTurns: 0, unpricedModel: null });
  });

  it("prices cache writes by TTL, cache reads and web searches", () => {
    const result = estimateGroup(table, {
      ...turn,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      webSearchCount: 500,
    });
    // input rate 3: 3 * 1.25 + 3 * 2 + 3 * 0.1 = 10.05, plus 500 searches at 10 per 1000
    expect(result.estimate).toBeCloseTo(10.05 + 5, 9);
  });

  it("uses the fast-mode rates for a fast turn and keeps the web search charge", () => {
    const result = estimateGroup(table, {
      ...turn,
      speed: "fast",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      webSearchCount: 1000,
    });
    expect(result.estimate).toBeCloseTo(6 + 30 + 10, 9);
  });

  it("gives the batch discount on token amounts only", () => {
    const result = estimateGroup(table, {
      ...turn,
      serviceTier: "batch",
      inputTokens: 1_000_000,
      webSearchCount: 1000,
    });
    expect(result.estimate).toBeCloseTo(3 * 0.5 + 10, 9);
  });

  it("sums a group of several turns once", () => {
    expect(estimateGroup(table, { ...turn, turns: 4, inputTokens: 1_000_000 }).estimate).toBe(3);
  });

  it("leaves a turn of an unknown model unpriced", () => {
    expect(
      estimateGroup(table, { ...turn, model: "other-model", turns: 3, inputTokens: 5 }),
    ).toEqual({
      estimate: 0,
      unpricedTurns: 3,
      unpricedModel: "other-model",
    });
  });

  it("leaves a fast turn unpriced when the row has no fast-mode rates", () => {
    const noFast = parsePriceTable({
      ...syntheticTable,
      models: [{ ...syntheticTable.models[0], fast: undefined }],
    });
    expect(estimateGroup(noFast, { ...turn, speed: "fast", inputTokens: 5 })).toEqual({
      estimate: 0,
      unpricedTurns: 1,
      unpricedModel: "claude-synthetic-1 (fast)",
    });
  });
});

describe("findRow", () => {
  const row = (model: string) => ({ ...syntheticTable.models[0], model });
  const table = parsePriceTable({
    ...syntheticTable,
    models: [row("claude-a"), row("claude-a-big"), row("claude-b-1")],
  });

  it("takes the longest matching prefix", () => {
    expect(findRow(table, "claude-a-big-20261101")?.model).toBe("claude-a-big");
    expect(findRow(table, "claude-a-20261101")?.model).toBe("claude-a");
  });

  it("takes the row with the same ID", () => {
    expect(findRow(table, "claude-b-1")?.model).toBe("claude-b-1");
  });

  it("returns nothing for an unknown model", () => {
    expect(findRow(table, "claude-c")).toBeUndefined();
  });
});
