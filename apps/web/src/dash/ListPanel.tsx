import {
  RUN_ID_MAX,
  SET_LABELS,
  type DashResponse,
  type WorkItem,
  type WorkItemsResponse,
  type WorkSet,
} from "@foreman/shared";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { fetchWorkItems } from "../api.ts";
import { ShowMoreList, usePagedList } from "../list/index.ts";
import { ScopedLink, useScope } from "../scope/index.ts";
import { itemKey } from "../work/labels.ts";
import { plural } from "./last-run.ts";
import { LIST_PANEL_ID } from "./panel-context.tsx";
import { PanelRow } from "./PanelRow.tsx";
import { NotConnected } from "./PipelineStrip.tsx";
import "./list-panel.css";

/** The panel asks again for its loaded pages each 60 seconds while the tab is visible. */
export const PANEL_REFRESH_MS = 60_000;

export const PANEL_ERROR_TEXT =
  "The list cannot be read. The API may be stopped: start it with pnpm dev, then reload this page.";

const RUN_SETS: readonly WorkSet[] = ["builds", "merged"];
const RUN_FOLDER_SETS: readonly WorkSet[] = ["builds", "merged", "waits"];

const emptyText = (set: WorkSet): string =>
  set === "builds"
    ? "No builds in this run."
    : set === "merged"
      ? "No merged builds in this run."
      : "No items in this scope.";

export interface ListPanelProps {
  set: WorkSet;
  /** The dash data, or undefined while it loads or when its request failed. */
  dash: DashResponse | undefined;
  dashFailed: boolean;
  /** Grows when the Operator opens a panel from the page: the heading takes the focus. */
  focusToken: number;
  onClose: () => void;
}

const rowKey = (item: WorkItem): string => `${item.context?.kind ?? "work"}:${itemKey(item)}`;

function headingOf(set: WorkSet, first: WorkItemsResponse | undefined, rows: number): string {
  if (first === undefined) return SET_LABELS[set];
  if (set === "escalated" && first.events !== null) {
    return `${plural(first.events, "Escalation", "Escalations")} on ${plural(rows, "pull request", "pull requests")}`;
  }
  if (set === "waivers" && first.events !== null) {
    return `${plural(first.events, "Waiver", "Waivers")} on ${plural(rows, "pull request", "pull requests")}`;
  }
  return SET_LABELS[set];
}

/** The List panel: the items behind one number of the dash. */
export function ListPanel({ set, dash, dashFailed, focusToken, onClose }: ListPanelProps) {
  const { scope, clientsSettled, unknownClient } = useScope();
  const heading = useRef<HTMLHeadingElement>(null);
  const needsRun = RUN_SETS.includes(set);
  const run = dash?.lastRun?.runId ?? null;
  const runUsable = run !== null && run.length <= RUN_ID_MAX;
  const request: Record<string, string> = {
    set,
    ...(scope === null ? {} : { client: scope }),
    ...(needsRun && run !== null ? { run } : {}),
  };
  const waitingForDash = needsRun && dash === undefined && !dashFailed;
  const failedDash = needsRun && dashFailed;
  const noRun = needsRun && dash !== undefined && !runUsable;

  const list = usePagedList<WorkItem, WorkItemsResponse>({
    queryKey: ["dash", "panel", request],
    fetchPage: (cursor, signal) => fetchWorkItems(request, cursor, signal),
    enabled: clientsSettled && !unknownClient && !waitingForDash && !failedDash && !noRun,
    refetchInterval: PANEL_REFRESH_MS,
  });

  useEffect(() => {
    if (focusToken > 0) heading.current?.focus();
  }, [focusToken]);

  const first = list.firstPage;
  const failed = failedDash || list.isError;
  const unreadable =
    first?.sources != null &&
    (RUN_FOLDER_SETS.includes(set)
      ? first.sources.runs === "unreadable"
      : !set.startsWith("stage_") && first.sources.controls === "unreadable");
  const rows = first === undefined ? 0 : first.counts.all;
  const summaryHeading = set === "escalated" || set === "waivers";
  const showCount = first !== undefined && !summaryHeading;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <aside
      id={LIST_PANEL_ID}
      className="list-panel"
      aria-labelledby="list-panel-heading"
      onKeyDown={onKeyDown}
    >
      <div className="list-panel-head">
        <h2 id="list-panel-heading" ref={heading} tabIndex={-1}>
          {headingOf(set, first, rows)}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close the list">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {showCount ? <p className="muted">{plural(rows, "item", "items")}</p> : null}
      {failed ? (
        <p role="alert" className="note note-warn">
          {PANEL_ERROR_TEXT}
        </p>
      ) : null}
      {waitingForDash ? <p role="status">Reading the dash.</p> : null}
      {!failed && !waitingForDash && list.isPending && !noRun ? (
        <p role="status">Reading the list.</p>
      ) : null}
      {first?.state === "not_connected" ? <NotConnected /> : null}
      {unreadable ? <p className="muted">cannot read the factory folder</p> : null}
      {noRun ? <p className="muted">No items in this scope.</p> : null}
      {first !== undefined && list.rows.length === 0 && !unreadable && first.state === "ok" ? (
        <p className="muted">{emptyText(set)}</p>
      ) : null}
      {list.rows.length > 0 ? (
        <ShowMoreList
          list={list}
          label={SET_LABELS[set]}
          rowKey={rowKey}
          renderRow={(item) => <PanelRow item={item} />}
        />
      ) : null}
      {needsRun && !runUsable ? null : (
        <p>
          <ScopedLink to={`/work?${new URLSearchParams(workParams(set, run)).toString()}`}>
            Open in the Work view
          </ScopedLink>
        </p>
      )}
    </aside>
  );
}

function workParams(set: WorkSet, run: string | null): Record<string, string> {
  return { set, ...(RUN_SETS.includes(set) && run !== null ? { run } : {}) };
}
