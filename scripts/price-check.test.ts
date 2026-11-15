import { describe, expect, it } from "vitest";
import { checkPriceTable, formatReport, parsePricingPage, PriceParseError } from "./price-check.ts";

const URL_A = "https://example.invalid/pricing";
const source = { source_url: URL_A, as_of: "2026-11-01" };

function nameCell(name: string): string {
  return `<td><div><a href="/m">${name}</a><span>A synthetic description</span></div></td>`;
}

function row(cells: string[]): string {
  return `<tr>${cells.map((c) => (c.startsWith("<td") ? c : `<td>${c}</td>`)).join("")}</tr>`;
}

const baseTable = (rows: string[]) =>
  `<table><thead><tr><th>Model</th><th colSpan="2">Base tokens</th><th colSpan="3">Prompt caching</th></tr>` +
  `<tr><th>Name</th><th>Input</th><th>Output</th><th>5m writes</th><th>1h writes</th><th>Hits</th></tr></thead>` +
  `<tbody>${rows.join("")}</tbody></table>`;

const fastTable = (rows: string[]) =>
  `<table><thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;

const cacheTable = (w5: string, w1: string, read: string) =>
  `<table><thead><tr><th>Cache operation</th><th>Multiplier</th><th>Duration</th></tr></thead><tbody>` +
  row(["5-minute cache write", `${w5} base input price`, "5 minutes"]) +
  row(["1-hour cache write", `${w1} base input price`, "1 hour"]) +
  row(["Cache read (hit)", `${read} base input price on most models`, "Same"]) +
  `</tbody></table>`;

const synthRow = (name: string, input: string, output: string) =>
  row([
    nameCell(name),
    `${input} / MTok`,
    `${output} / MTok`,
    "$1 / MTok",
    "$2 / MTok",
    "$0.1 / MTok",
  ]);

const page = (...tables: string[]) =>
  `<html><body><h1>Pricing</h1>${tables.join("")}</body></html>`;

const syntheticPage = page(
  baseTable([
    synthRow("Claude Synthetic 1", "$3", "$15"),
    synthRow("Claude Tiered 2", "$0.10", "$0.50"),
    row(["$0.50 / MTok for prompts over 100,000 tokens", "$2.50 / MTok", "$1 / MTok", "$1", "$1"]),
  ]),
  cacheTable("1.25x", "2x", "0.1x"),
  fastTable([row(["Claude Synthetic 1", "$6 USD / MTok", "$30 USD / MTok"])]),
);

const modelRows = [
  {
    model: "claude-synthetic-1",
    input_per_mtok: 3,
    output_per_mtok: 15,
    fast: { input_per_mtok: 6, output_per_mtok: 30 },
    ...source,
  },
  { model: "claude-tiered-2", input_per_mtok: 0.1, output_per_mtok: 0.5, ...source },
];
const rules = {
  cache_write_5m_multiplier: 1.25,
  cache_write_1h_multiplier: 2,
  cache_read_multiplier: 0.1,
  batch_discount: 0.5,
  web_search_per_1000: 10,
  ...source,
};
const [firstRow, secondRow] = modelRows as [(typeof modelRows)[number], (typeof modelRows)[number]];
const table = { models: modelRows, rules };

function fetchOf(pages: Record<string, string>) {
  const calls: string[] = [];
  const fetchHtml = (url: string): Promise<string> => {
    calls.push(url);
    const body = pages[url];
    return body === undefined ? Promise.reject(new Error("Network down")) : Promise.resolve(body);
  };
  return { fetchHtml, calls };
}

describe("parsePricingPage", () => {
  it("reads the model IDs, the base rates, the fast rates and the cache multipliers", () => {
    const parsed = parsePricingPage(syntheticPage);
    expect(parsed.models).toEqual([
      { id: "claude-synthetic-1", input: 3, output: 15, fast: { input: 6, output: 30 } },
      { id: "claude-tiered-2", input: 0.1, output: 0.5 },
    ]);
    expect(parsed.cache).toEqual({ write5m: 1.25, write1h: 2, read: 0.1 });
  });

  it("throws when the page has no model rate table", () => {
    expect(() => parsePricingPage("<html><body>Moved</body></html>")).toThrow(PriceParseError);
  });

  it("throws when a rate cell has no number", () => {
    const broken = page(
      baseTable([row([nameCell("Claude Synthetic 1"), "Contact us", "$15 / MTok"])]),
    );
    expect(() => parsePricingPage(broken)).toThrow(PriceParseError);
  });
});

describe("checkPriceTable", () => {
  it("finds nothing when the page and the table agree", async () => {
    const { fetchHtml, calls } = fetchOf({ [URL_A]: syntheticPage });
    expect(await checkPriceTable(table, fetchHtml)).toEqual([]);
    expect(calls).toEqual([URL_A]);
  });

  it("names a rate that differs", async () => {
    const changed = page(
      baseTable([
        synthRow("Claude Synthetic 1", "$4", "$15"),
        synthRow("Claude Tiered 2", "$0.10", "$0.50"),
      ]),
      cacheTable("1.25x", "2x", "0.1x"),
      fastTable([row(["Claude Synthetic 1", "$6 USD / MTok", "$30 USD / MTok"])]),
    );
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: changed }).fetchHtml);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("rate-differs");
    expect(findings[0]?.message).toContain("claude-synthetic-1");
    expect(findings[0]?.message).toContain("input");
    expect(findings[0]?.message).toContain("4");
  });

  it("names a fast rate and a cache multiplier that differ", async () => {
    const changed = page(
      baseTable([
        synthRow("Claude Synthetic 1", "$3", "$15"),
        synthRow("Claude Tiered 2", "$0.10", "$0.50"),
      ]),
      cacheTable("1.5x", "2x", "0.1x"),
      fastTable([row(["Claude Synthetic 1", "$7 USD / MTok", "$30 USD / MTok"])]),
    );
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: changed }).fetchHtml);
    const messages = findings.map((f) => f.message).join("\n");
    expect(findings.every((f) => f.kind === "rate-differs")).toBe(true);
    expect(messages).toContain("fast input");
    expect(messages).toContain("5-minute cache write");
  });

  it("names a model that the table does not have", async () => {
    const extra = page(
      baseTable([
        synthRow("Claude Synthetic 1", "$3", "$15"),
        synthRow("Claude Tiered 2", "$0.10", "$0.50"),
        synthRow("Claude Brandnew 9", "$1", "$5"),
      ]),
      cacheTable("1.25x", "2x", "0.1x"),
      fastTable([row(["Claude Synthetic 1", "$6 USD / MTok", "$30 USD / MTok"])]),
    );
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: extra }).fetchHtml);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("model-missing");
    expect(findings[0]?.message).toContain("claude-brandnew-9");
  });

  it("matches a table row that is an ID prefix", async () => {
    const prefixed = {
      ...table,
      models: [{ ...firstRow, model: "claude-synthetic" }, secondRow],
    };
    const findings = await checkPriceTable(prefixed, fetchOf({ [URL_A]: syntheticPage }).fetchHtml);
    expect(findings).toEqual([]);
  });

  it("matches a table row whose ID is longer than the page ID", async () => {
    const dated = {
      ...table,
      models: [{ ...firstRow, model: "claude-synthetic-1-20250805" }, secondRow],
    };
    const findings = await checkPriceTable(dated, fetchOf({ [URL_A]: syntheticPage }).fetchHtml);
    expect(findings).toEqual([]);
  });

  it("does not match a longer table ID of another model version", async () => {
    const other = {
      ...table,
      models: [{ ...firstRow, model: "claude-synthetic-1-5-20250805" }, secondRow],
    };
    const findings = await checkPriceTable(other, fetchOf({ [URL_A]: syntheticPage }).fetchHtml);
    expect(findings.map((finding) => finding.kind)).toContain("model-missing");
  });

  it("compares the rates of a table row whose ID is longer than the page ID", async () => {
    const dated = {
      ...table,
      models: [{ ...firstRow, model: "claude-synthetic-1-20250805", input_per_mtok: 2 }, secondRow],
    };
    const findings = await checkPriceTable(dated, fetchOf({ [URL_A]: syntheticPage }).fetchHtml);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("rate-differs");
    expect(findings[0]?.message).toContain("claude-synthetic-1-20250805 input");
  });

  it("reports a page that cannot be parsed", async () => {
    const findings = await checkPriceTable(
      table,
      fetchOf({ [URL_A]: "<html>Moved</html>" }).fetchHtml,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("unparseable");
    expect(findings[0]?.message).toContain(URL_A);
  });

  it("reports a page that has the cache table but no model rate table", async () => {
    const cacheOnly = page(cacheTable("1.25x", "2x", "0.1x"));
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: cacheOnly }).fetchHtml);
    expect(findings).toEqual([
      { kind: "unparseable", message: `The page ${URL_A} has no model rate table.` },
    ]);
  });

  it("reports a page that has the model rate table but no cache table", async () => {
    const modelsOnly = page(
      baseTable([
        synthRow("Claude Synthetic 1", "$3", "$15"),
        synthRow("Claude Tiered 2", "$0.10", "$0.50"),
      ]),
      fastTable([row(["Claude Synthetic 1", "$6 USD / MTok", "$30 USD / MTok"])]),
    );
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: modelsOnly }).fetchHtml);
    expect(findings).toEqual([
      { kind: "unparseable", message: `The page ${URL_A} has no cache table.` },
    ]);
  });

  it("reports a page that cannot be fetched", async () => {
    const findings = await checkPriceTable(table, fetchOf({}).fetchHtml);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("unparseable");
    expect(findings[0]?.message).toContain("Network down");
  });

  it("reports a table row with a fast rate that the page does not show", async () => {
    const noFast = page(
      baseTable([
        synthRow("Claude Synthetic 1", "$3", "$15"),
        synthRow("Claude Tiered 2", "$0.10", "$0.50"),
      ]),
      cacheTable("1.25x", "2x", "0.1x"),
    );
    const findings = await checkPriceTable(table, fetchOf({ [URL_A]: noFast }).fetchHtml);
    expect(findings.map((f) => f.kind)).toEqual(["rate-differs"]);
    expect(findings[0]?.message).toContain("fast");
  });

  it("fetches each distinct source URL once", async () => {
    const urlB = "https://example.invalid/other";
    const two = { models: [firstRow, { ...secondRow, source_url: urlB }], rules };
    const { fetchHtml, calls } = fetchOf({ [URL_A]: syntheticPage, [urlB]: syntheticPage });
    await checkPriceTable(two, fetchHtml);
    expect([...calls].sort()).toEqual([URL_A, urlB].sort());
  });

  it("reports an empty table as a finding with no fetch", async () => {
    const { fetchHtml, calls } = fetchOf({});
    const findings = await checkPriceTable({ models: [], rules: null }, fetchHtml);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("no-source");
    expect(findings[0]?.message).toBe("The price table has no source URL to check.");
    expect(calls).toEqual([]);
  });
});

describe("formatReport", () => {
  it("lists each finding in a Markdown body", () => {
    const body = formatReport([
      { kind: "rate-differs", message: "First" },
      { kind: "model-missing", message: "Second" },
    ]);
    expect(body).toContain("- First");
    expect(body).toContain("- Second");
  });
});
