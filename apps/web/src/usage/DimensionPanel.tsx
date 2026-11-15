import type { BreakdownResponse } from "@foreman/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  formatDate,
  formatEstimate,
  formatNumber,
  formatTime,
  formatTokens,
  MISSING,
} from "../format/index.ts";
import { ScopedLink } from "../scope/index.ts";
import {
  TAB_NAMES,
  UNASSIGNED,
  columnsFor,
  nextSort,
  sharePercent,
  sortRows,
  type Column,
  type DimensionRow,
  type Sort,
} from "./dimension.ts";
import type { Metric, UsageTab } from "./url-state/index.ts";

const EMPTY = "No usage in this range in this scope.";
const FAILED = "This panel cannot load the data. Try Refresh.";
const SKILL_NOTE =
  "Estimated turns are an estimate: the turns of the main conversation from a skill call to your next message.";

function time(value: string | undefined): string {
  if (value === undefined) return MISSING;
  return `${formatDate(value)} ${formatTime(value)}`;
}

function share(percent: number | null): string {
  return percent === null ? MISSING : `${formatNumber(percent)}%`;
}

function count(value: number | undefined): string {
  return value === undefined ? MISSING : formatNumber(value);
}

interface CellContext {
  metric: Metric;
  data: BreakdownResponse;
  /** The link to the page of a Project row. Rows of other tabs have none. */
  projectHref: ((projectId: string) => string) | null;
}

function cell(row: DimensionRow, column: Column, context: CellContext): ReactNode {
  switch (column.id) {
    case "label":
      return context.projectHref === null ? (
        row.label
      ) : (
        <ScopedLink to={context.projectHref(row.key)}>{row.label}</ScopedLink>
      );
    case "client":
      return row.client ?? UNASSIGNED;
    case "firstTurn":
      return time(row.firstTurnAt);
    case "lastTurn":
      return time(row.lastTurnAt);
    case "share":
      return share(sharePercent(row, context.data.totals, context.metric, row.unpricedTurns > 0));
    case "input":
      return formatTokens(row.inputTokens);
    case "output":
      return formatTokens(row.outputTokens);
    case "cacheWrite":
      return formatTokens(row.cacheWriteTokens);
    case "cacheRead":
      return formatTokens(row.cacheReadTokens);
    case "turns":
      return formatNumber(row.turns);
    case "estimate":
      return formatEstimate(row.estimate);
    case "calls":
      return count(row.calls);
    case "exactTurns":
      return count(row.exactTurns);
    case "estimatedTurns":
      return count(row.estimatedTurns);
  }
}

function totalsCell(column: Column, data: BreakdownResponse, metric: Metric): string {
  const { totals } = data;
  switch (column.id) {
    case "label":
      return "Total";
    case "share":
      return share(sharePercent(totals, totals, metric, totals.unpricedTurns > 0));
    case "input":
      return formatTokens(totals.inputTokens);
    case "output":
      return formatTokens(totals.outputTokens);
    case "cacheWrite":
      return formatTokens(totals.cacheWriteTokens);
    case "cacheRead":
      return formatTokens(totals.cacheReadTokens);
    case "turns":
      return formatNumber(totals.turns);
    case "estimate":
      return formatEstimate(totals.estimate);
    default:
      return "";
  }
}

const NUMERIC = new Set([
  "share",
  "input",
  "output",
  "cacheWrite",
  "cacheRead",
  "turns",
  "estimate",
  "calls",
  "exactTurns",
  "estimatedTurns",
]);

function Note({ tab, data }: { tab: UsageTab; data: BreakdownResponse }) {
  const shown = data.rows.length;
  const all = formatNumber(data.rowCount);
  let cut = null;
  if (data.rowCount > shown) {
    cut =
      tab === "session" ? (
        <p className="muted">{`Top ${formatNumber(shown)} of ${all} sessions. The totals include all ${all} sessions.`}</p>
      ) : (
        <p className="muted">{`Top ${formatNumber(shown)} of ${all} by tokens`}</p>
      );
  }
  return (
    <>
      {cut}
      {tab === "skill" ? <p className="muted">{SKILL_NOTE}</p> : null}
      <p className="muted">{data.note}</p>
    </>
  );
}

function DimensionTable({
  tab,
  metric,
  data,
  projectHref,
}: {
  tab: UsageTab;
  metric: Metric;
  data: BreakdownResponse;
  projectHref: ((projectId: string) => string) | null;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const columns = columnsFor(tab);
  const rows = useMemo(() => sortRows(data.rows, sort, metric), [data.rows, sort, metric]);
  const context: CellContext = {
    metric,
    data,
    projectHref: tab === "project" ? projectHref : null,
  };
  const caption = `Usage by ${TAB_NAMES[tab]}`;
  return (
    <>
      <div className="table-scroll" role="region" aria-label={`${caption} table`} tabIndex={0}>
        <table className="usage-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sort?.column === column.id ? sort.direction : undefined}
                  className={NUMERIC.has(column.id) ? "num" : undefined}
                >
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => {
                      setSort((current) => nextSort(current, column.id));
                    }}
                  >
                    {column.header}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {columns.map((column) =>
                  column.id === "label" ? (
                    <th key={column.id} scope="row">
                      {cell(row, column, context)}
                    </th>
                  ) : (
                    <td key={column.id} className={NUMERIC.has(column.id) ? "num" : undefined}>
                      {cell(row, column, context)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {columns.map((column) =>
                column.id === "label" ? (
                  <th key={column.id} scope="row">
                    {totalsCell(column, data, metric)}
                  </th>
                ) : (
                  <td key={column.id} className={NUMERIC.has(column.id) ? "num" : undefined}>
                    {totalsCell(column, data, metric)}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <Note tab={tab} data={data} />
    </>
  );
}

export interface DimensionPanelProps {
  tabs: readonly UsageTab[];
  tab: UsageTab;
  metric: Metric;
  query: UseQueryResult<BreakdownResponse>;
  /** The link to the Project page of a Project ID, for the rows of the tab Project. */
  projectHref: ((projectId: string) => string) | null;
  onTab: (tab: UsageTab) => void;
}

export function DimensionPanel({
  tabs,
  tab,
  metric,
  query,
  projectHref,
  onTab,
}: DimensionPanelProps) {
  const buttons = useRef(new Map<UsageTab, HTMLButtonElement>());

  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const next = target === null ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onTab(next);
    buttons.current.get(next)?.focus();
  };

  let body;
  if (query.isPending) {
    body = (
      <div
        role="status"
        aria-label="Loading Usage by dimension"
        className="skeleton table-skeleton"
      />
    );
  } else if (query.isError) {
    body = (
      <p role="status" className="note note-warn">
        {FAILED}
      </p>
    );
  } else if (query.data.rows.length === 0) {
    body = <p>{EMPTY}</p>;
  } else {
    body = (
      <DimensionTable
        key={tab}
        tab={tab}
        metric={metric}
        data={query.data}
        projectHref={projectHref}
      />
    );
  }

  return (
    <section className="card panel" aria-labelledby="usage-by-dimension">
      <h2 id="usage-by-dimension">Usage by dimension</h2>
      <p className="muted">From the Usage index: the usage of the range, split by one dimension.</p>
      <div role="tablist" aria-label="Dimension" className="tabs">
        {tabs.map((name, index) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`dimension-tab-${name}`}
            aria-selected={name === tab}
            aria-controls="dimension-panel"
            tabIndex={name === tab ? 0 : -1}
            ref={(element) => {
              if (element === null) buttons.current.delete(name);
              else buttons.current.set(name, element);
            }}
            onClick={() => {
              onTab(name);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
          >
            {TAB_NAMES[name]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="dimension-panel"
        aria-labelledby={`dimension-tab-${tab}`}
        className="panel-body"
      >
        {body}
      </div>
    </section>
  );
}
