import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { findRow, loadPriceTable } from "@foreman/api/prices";
import type { PriceTable } from "@foreman/api/prices";

export interface Finding {
  kind: "rate-differs" | "model-missing" | "unparseable" | "no-source";
  message: string;
}

const Rate = z.number().nonnegative();
const Multiplier = z.number().nonnegative();

const PagePrices = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string().min(1),
          input: Rate,
          output: Rate,
          fast: z.object({ input: Rate, output: Rate }).strict().optional(),
        })
        .strict(),
    ),
    cache: z
      .object({ write5m: Multiplier, write1h: Multiplier, read: Multiplier })
      .strict()
      .nullable(),
  })
  .strict();

export type PagePrices = z.infer<typeof PagePrices>;

export class PriceParseError extends Error {}

const TABLE = /<table[\s\S]*?<\/table>/gi;
const ROW = /<tr[\s\S]*?<\/tr>/gi;
const CELL = /<t([dh])[\s\S]*?<\/t[dh]>/gi;
const ANCHOR = /<a\b[^>]*>([\s\S]*?)<\/a>/i;

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Each row as its cell texts. A model name cell gives its link text, not its description. */
function rowsOf(table: string): string[][] {
  return (table.match(ROW) ?? []).map((tr) =>
    (tr.match(CELL) ?? []).map((cell) => text(ANCHOR.exec(cell)?.[1] ?? cell)),
  );
}

function modelId(name: string): string | null {
  if (!/^claude\b/i.test(name)) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function modelIds(names: string): string[] {
  return names
    .split(/\s*\/\s*|\s+and\s+/)
    .map(modelId)
    .filter((id) => id !== null);
}

/** The first dollar amount of a cell: the rate for the base prompt size. */
function dollars(cell: string | undefined, what: string): number {
  const match = /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(cell ?? "");
  if (match?.[1] === undefined) throw new PriceParseError(`No rate in the ${what} cell`);
  return Number(match[1].replaceAll(",", ""));
}

function multiplier(cell: string | undefined, what: string): number {
  const match = /([0-9]+(?:\.[0-9]+)?)\s*x/i.exec(cell ?? "");
  if (match?.[1] === undefined) throw new PriceParseError(`No multiplier in the ${what} row`);
  return Number(match[1]);
}

/** Reads the rates of the pricing page. It is a pure function, so tests run it on fixtures. */
export function parsePricingPage(html: string): PagePrices {
  const models = new Map<string, PagePrices["models"][number]>();
  const fast = new Map<string, { input: number; output: number }>();
  let cache: PagePrices["cache"] = null;

  for (const table of html.match(TABLE) ?? []) {
    const rows = rowsOf(table);
    const header = rows[0] ?? [];
    if (header.includes("Base tokens")) {
      for (const [name, input, output] of rows.slice(2)) {
        // A row with no name cell is a second price tier of the model above.
        const id = name === undefined ? null : modelId(name);
        if (id === null) continue;
        models.set(id, { id, input: dollars(input, id), output: dollars(output, id) });
      }
    } else if (header.join("|") === "Model|Input|Output") {
      for (const [names, input, output] of rows.slice(1)) {
        for (const id of modelIds(names ?? "")) {
          fast.set(id, {
            input: dollars(input, `fast ${id}`),
            output: dollars(output, `fast ${id}`),
          });
        }
      }
    } else if (header[0] === "Cache operation") {
      const find = (label: RegExp) => rows.find(([first]) => label.test(first ?? ""));
      const write5m = find(/5-minute/i);
      const write1h = find(/1-hour/i);
      const read = find(/read/i);
      cache = {
        write5m: multiplier(write5m?.[1], "5-minute cache write"),
        write1h: multiplier(write1h?.[1], "1-hour cache write"),
        read: multiplier(read?.[1], "cache read"),
      };
    }
  }

  if (models.size === 0 && cache === null) {
    throw new PriceParseError("No model rate table and no cache table found");
  }
  const withFast = [...models.values()].map((model) => {
    const rates = fast.get(model.id);
    return rates === undefined ? model : { ...model, fast: rates };
  });
  const result = PagePrices.safeParse({ models: withFast, cache });
  if (!result.success) throw new PriceParseError("The parsed rates are not valid");
  return result.data;
}

const EPSILON = 1e-9;

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

/** The row for a page ID: the API lookup, else a row whose longer ID starts with the page ID. */
function matchRow(table: PriceTable, id: string): PriceTable["models"][number] | undefined {
  return findRow(table, id) ?? table.models.find((row) => row.model.startsWith(id));
}

function comparePage(table: PriceTable, url: string, page: PagePrices): Finding[] {
  const findings: Finding[] = [];
  const rate = (what: string, was: number, now: number) =>
    findings.push({
      kind: "rate-differs",
      message: `${what}: the table has ${String(was)}, the page ${url} has ${String(now)}.`,
    });

  const rows = table.models.filter((row) => row.source_url === url);
  if (rows.length > 0) {
    const sub: PriceTable = { models: rows, rules: null };
    for (const model of page.models) {
      const row = matchRow(sub, model.id);
      if (row === undefined) {
        findings.push({
          kind: "model-missing",
          message: `Model ${model.id} is on the page ${url} (input ${String(model.input)}, output ${String(model.output)} USD per 1M tokens) but not in the table.`,
        });
        continue;
      }
      if (differs(row.input_per_mtok, model.input)) {
        rate(`${row.model} input`, row.input_per_mtok, model.input);
      }
      if (differs(row.output_per_mtok, model.output)) {
        rate(`${row.model} output`, row.output_per_mtok, model.output);
      }
      if (row.fast !== undefined && model.fast === undefined) {
        findings.push({
          kind: "rate-differs",
          message: `${row.model} fast rates: the table has fast rates, the page ${url} has none.`,
        });
      } else if (row.fast !== undefined && model.fast !== undefined) {
        if (differs(row.fast.input_per_mtok, model.fast.input)) {
          rate(`${row.model} fast input`, row.fast.input_per_mtok, model.fast.input);
        }
        if (differs(row.fast.output_per_mtok, model.fast.output)) {
          rate(`${row.model} fast output`, row.fast.output_per_mtok, model.fast.output);
        }
      }
    }
  }

  const { rules } = table;
  if (rules?.source_url === url && page.cache !== null) {
    const pairs = [
      ["5-minute cache write multiplier", rules.cache_write_5m_multiplier, page.cache.write5m],
      ["1-hour cache write multiplier", rules.cache_write_1h_multiplier, page.cache.write1h],
      ["cache read multiplier", rules.cache_read_multiplier, page.cache.read],
    ] as const;
    for (const [what, was, now] of pairs) {
      if (differs(was, now)) rate(what, was, now);
    }
  }
  return findings;
}

/**
 * Compares the price table with the pages of its source URLs. The batch discount and the
 * web search charge are not checked: the page states them in prose, not in a table.
 */
export async function checkPriceTable(
  table: PriceTable,
  fetchHtml: (url: string) => Promise<string>,
): Promise<Finding[]> {
  const urls = [
    ...new Set([...table.models.map((row) => row.source_url), table.rules?.source_url ?? null]),
  ].filter((url) => url !== null);
  if (urls.length === 0) {
    return [{ kind: "no-source", message: "The price table has no source URL to check." }];
  }

  const findings: Finding[] = [];
  for (const url of urls) {
    let page: PagePrices;
    try {
      page = parsePricingPage(await fetchHtml(url));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      findings.push({
        kind: "unparseable",
        message: `Cannot read the page ${url}: ${reason}.`,
      });
      continue;
    }
    if (table.models.some((row) => row.source_url === url) && page.models.length === 0) {
      findings.push({ kind: "unparseable", message: `The page ${url} has no model rate table.` });
    }
    if (table.rules?.source_url === url && page.cache === null) {
      findings.push({ kind: "unparseable", message: `The page ${url} has no cache table.` });
    }
    findings.push(...comparePage(table, url, page));
  }
  return findings;
}

export function formatReport(findings: Finding[]): string {
  return [
    "The weekly price check found differences between `data/price-table.json` and the public pricing page.",
    "",
    ...findings.map((finding) => `- ${finding.message}`),
    "",
    "Update the price table, then close this issue.",
    "",
  ].join("\n");
}

const TIMEOUT_MS = 20_000;
const TABLE_FILE = new URL("../data/price-table.json", import.meta.url);

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Status ${String(response.status)}`);
  return response.text();
}

/** Writes the report file only when there are findings. The workflow tests that the file exists. */
async function main(reportFile: string | undefined): Promise<void> {
  if (reportFile === undefined) throw new Error("Usage: price-check.ts <report file>");
  const table = await loadPriceTable(TABLE_FILE.pathname);
  const findings = await checkPriceTable(table, fetchPage);
  if (findings.length === 0) {
    console.log("No differences.");
    return;
  }
  await writeFile(reportFile, formatReport(findings));
  console.log(`${String(findings.length)} finding(s) written to the report file.`);
}

if (import.meta.main) {
  await main(process.argv[2]);
}
