import { readFile } from "node:fs/promises";
import { z } from "zod";

const Source = {
  source_url: z.url(),
  as_of: z.iso.date(),
};

const Rate = z.number().nonnegative();

const ModelRow = z
  .object({
    /** A model ID, or an ID prefix. */
    model: z.string().min(1),
    input_per_mtok: Rate,
    output_per_mtok: Rate,
    fast: z.object({ input_per_mtok: Rate, output_per_mtok: Rate }).strict().optional(),
    ...Source,
  })
  .strict();

const Rules = z
  .object({
    cache_write_5m_multiplier: Rate,
    cache_write_1h_multiplier: Rate,
    cache_read_multiplier: Rate,
    /** The part of the token amounts that a batch turn does not pay: 0.5 is half. */
    batch_discount: z.number().min(0).max(1),
    web_search_per_1000: Rate,
    ...Source,
  })
  .strict();

export const PriceTable = z
  .object({ models: z.array(ModelRow), rules: Rules.nullable() })
  .strict()
  .refine((table) => table.models.length === 0 || table.rules !== null, {
    message: "rules are required when the table has a model row",
    path: ["rules"],
  });

export type PriceTable = z.infer<typeof PriceTable>;

export function parsePriceTable(value: unknown): PriceTable {
  const result = PriceTable.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "(root)");
    throw new Error(`Invalid price table: ${[...new Set(fields)].join(", ")}`);
  }
  return result.data;
}

/** Reads and validates the price table. It throws, so that the API stops at start-up. */
export async function loadPriceTable(file: string): Promise<PriceTable> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Cannot read the price table ${file}`);
  }
  try {
    return parsePriceTable(value);
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : "invalid"}`, {
      cause: error,
    });
  }
}

export interface TurnGroup {
  model: string;
  speed: string | null;
  serviceTier: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  webSearchCount: number;
  turns: number;
}

export interface GroupEstimate {
  /** USD. Zero when the group is unpriced. */
  estimate: number;
  unpricedTurns: number;
  /** The model name with the speed flag, for a group that is unpriced. */
  unpricedModel: string | null;
}

/** The row with the same ID, else the row with the longest matching prefix. */
export function findRow(
  table: PriceTable,
  model: string,
): PriceTable["models"][number] | undefined {
  let best: PriceTable["models"][number] | undefined;
  for (const row of table.models) {
    if (!model.startsWith(row.model)) continue;
    if (best === undefined || row.model.length > best.model.length) best = row;
  }
  return best;
}

const PER_MILLION = 1_000_000;

/** The list-price estimate of a group of turns that share a model, speed and service tier. */
export function estimateGroup(table: PriceTable, group: TurnGroup): GroupEstimate {
  const fast = group.speed === "fast";
  const row = findRow(table, group.model);
  const rates = fast ? row?.fast : row;
  if (row === undefined || rates === undefined || table.rules === null) {
    return {
      estimate: 0,
      unpricedTurns: group.turns,
      unpricedModel: fast ? `${group.model} (fast)` : group.model,
    };
  }
  const { rules } = table;
  const inputRate = rates.input_per_mtok / PER_MILLION;
  const tokens =
    group.inputTokens * inputRate +
    group.outputTokens * (rates.output_per_mtok / PER_MILLION) +
    group.cacheWrite5mTokens * inputRate * rules.cache_write_5m_multiplier +
    group.cacheWrite1hTokens * inputRate * rules.cache_write_1h_multiplier +
    group.cacheReadTokens * inputRate * rules.cache_read_multiplier;
  const discounted = group.serviceTier === "batch" ? tokens * (1 - rules.batch_discount) : tokens;
  const searches = (group.webSearchCount / 1000) * rules.web_search_per_1000;
  return { estimate: discounted + searches, unpricedTurns: 0, unpricedModel: null };
}
