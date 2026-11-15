import type { BreakdownResponse } from "@foreman/shared";
import { totalTokens } from "./metric.ts";
import type { Metric, UsageTab } from "./url-state/index.ts";

export type DimensionRow = BreakdownResponse["rows"][number];
export type DimensionTotals = BreakdownResponse["totals"];

export const TAB_NAMES: Record<UsageTab, string> = {
  project: "Project",
  model: "Model",
  agentType: "Agent type",
  skill: "Skill",
  branch: "Branch",
  session: "Session",
};

/** The most rows that the API sends for a tab. */
export function rowLimit(tab: UsageTab): number {
  return tab === "session" ? 25 : 500;
}

export type ColumnId =
  | "label"
  | "client"
  | "firstTurn"
  | "lastTurn"
  | "share"
  | "input"
  | "output"
  | "cacheWrite"
  | "cacheRead"
  | "turns"
  | "estimate"
  | "calls"
  | "exactTurns"
  | "estimatedTurns";

export interface Column {
  id: ColumnId;
  header: string;
}

const FIGURES: Column[] = [
  { id: "share", header: "Share" },
  { id: "input", header: "Input" },
  { id: "output", header: "Output" },
  { id: "cacheWrite", header: "Cache write" },
  { id: "cacheRead", header: "Cache read" },
  { id: "turns", header: "Turns" },
  { id: "estimate", header: "List-price estimate" },
];

/** The columns of a tab, in the order of the table. */
export function columnsFor(tab: UsageTab): Column[] {
  const label: Column = { id: "label", header: tab === "session" ? "Project" : TAB_NAMES[tab] };
  if (tab === "project") return [label, { id: "client", header: "Client" }, ...FIGURES];
  if (tab === "session") {
    return [
      label,
      { id: "firstTurn", header: "First turn" },
      { id: "lastTurn", header: "Last turn" },
      ...FIGURES,
    ];
  }
  if (tab === "skill") {
    return [
      label,
      ...FIGURES,
      { id: "calls", header: "Calls" },
      { id: "exactTurns", header: "Exact turns" },
      { id: "estimatedTurns", header: "Estimated turns" },
    ];
  }
  return [label, ...FIGURES];
}

/** The value of the active metric for a row. It is null for an estimate that has no price. */
export function metricOf(
  row: Pick<
    DimensionRow,
    "inputTokens" | "outputTokens" | "cacheWriteTokens" | "cacheReadTokens" | "turns" | "estimate"
  >,
  metric: Metric,
): number | null {
  if (metric === "tokens") return totalTokens(row);
  if (metric === "turns") return row.turns;
  return row.estimate;
}

/** The share of a row, as a whole percent. It is null when the row or the totals have no value. */
export function sharePercent(
  row: Parameters<typeof metricOf>[0],
  totals: DimensionTotals,
  metric: Metric,
  unpriced: boolean,
): number | null {
  const value = metricOf(row, metric);
  const whole = metricOf(totals, metric);
  if (value === null || whole === null || whole <= 0) return null;
  if (metric === "estimate" && unpriced) return null;
  return Math.round((value / whole) * 100);
}

export const UNASSIGNED = "Unassigned";

export type SortValue = number | string | null;

/** The value that a column sorts by. */
export function sortValue(row: DimensionRow, column: ColumnId, metric: Metric): SortValue {
  switch (column) {
    case "label":
      return row.label;
    case "client":
      return row.client ?? UNASSIGNED;
    case "firstTurn":
      return row.firstTurnAt ?? null;
    case "lastTurn":
      return row.lastTurnAt ?? null;
    case "share":
      return metricOf(row, metric);
    case "input":
      return row.inputTokens;
    case "output":
      return row.outputTokens;
    case "cacheWrite":
      return row.cacheWriteTokens;
    case "cacheRead":
      return row.cacheReadTokens;
    case "turns":
      return row.turns;
    case "estimate":
      return row.estimate;
    case "calls":
      return row.calls ?? null;
    case "exactTurns":
      return row.exactTurns ?? null;
    case "estimatedTurns":
      return row.estimatedTurns ?? null;
  }
}

export interface Sort {
  column: ColumnId;
  direction: "ascending" | "descending";
}

/** The first selection of a column sorts from high to low, the next one from low to high. */
export function nextSort(current: Sort | null, column: ColumnId): Sort {
  if (current?.column === column) {
    return { column, direction: current.direction === "descending" ? "ascending" : "descending" };
  }
  return { column, direction: "descending" };
}

function compare(a: SortValue, b: SortValue): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-GB");
}

/** The rows in the order of the sort. With no sort, they keep the order of the API. */
export function sortRows(
  rows: readonly DimensionRow[],
  sort: Sort | null,
  metric: Metric,
): DimensionRow[] {
  if (sort === null) return [...rows];
  const sign = sort.direction === "descending" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        sign *
          compare(sortValue(a.row, sort.column, metric), sortValue(b.row, sort.column, metric)) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}
