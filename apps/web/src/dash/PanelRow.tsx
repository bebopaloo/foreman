import type { WorkItem, WorkItemContext } from "@foreman/shared";
import { formatDuration, MISSING } from "../format/index.ts";
import { gateLabel, priorityLabel, safeLink, stateLabel } from "../work/labels.ts";
import { clock } from "./last-run.ts";

export const NOT_IN_CACHE = "not in the Work cache";

function Ref({ label, href }: { label: string; href: string | null }) {
  const safe = safeLink(href);
  return safe === null ? (
    <span className="mono">{label}</span>
  ) : (
    <a href={safe} target="_blank" rel="noreferrer noopener" className="mono">
      {label}
    </a>
  );
}

function FirstLine({ item }: { item: WorkItem }) {
  const { issue, pullRequest, context } = item;
  if (issue !== null) {
    return (
      <>
        <span className="mono">{item.fullName}</span>{" "}
        <Ref label={`#${issue.number.toString()}`} href={issue.link} />{" "}
        <span className="list-row-title">{issue.title}</span>
      </>
    );
  }
  if (pullRequest !== null) {
    return (
      <>
        <span className="mono">{item.fullName}</span>{" "}
        <Ref label={`PR #${pullRequest.number.toString()}`} href={pullRequest.link} />{" "}
        <span className="list-row-title">{pullRequest.title}</span>
      </>
    );
  }
  const number =
    context?.kind === "build"
      ? `#${context.issue.toString()}`
      : context?.kind === "review"
        ? `PR #${context.pullRequest.toString()}`
        : "";
  return (
    <>
      <span className="mono">
        {item.fullName} {number}
      </span>{" "}
      <span className="muted">{NOT_IN_CACHE}</span>
    </>
  );
}

function reviewDetail(context: Extract<WorkItemContext, { kind: "review" }>): string {
  const { detail } = context;
  switch (detail.type) {
    case "decision":
      return detail.decision;
    case "round":
      return `round ${detail.round.toString()}`;
    case "escalations":
      return detail.events
        .map((event) => `${event.pathTier ?? MISSING} → ${event.finalTier ?? MISSING}`)
        .join(", ");
    case "waivers":
      return detail.ids.join(", ");
  }
}

function stageLine(item: WorkItem): string {
  const parts = [stateLabel(item), priorityLabel(item)];
  if (item.pullRequest !== null) {
    parts.push(`PR #${item.pullRequest.number.toString()} checks ${item.pullRequest.checks}`);
  }
  const gate = gateLabel(item);
  if (gate !== null) parts.push(`gate ${gate}`);
  return parts.join(" · ");
}

function SecondLine({ item }: { item: WorkItem }) {
  const { context } = item;
  if (context === null) return <>{stageLine(item)}</>;
  switch (context.kind) {
    case "build": {
      const seconds = Math.max(0, (Date.parse(context.end) - Date.parse(context.start)) / 1000);
      return (
        <>
          {context.result} · {clock(context.start)} to {clock(context.end)} ·{" "}
          {formatDuration(seconds)}
        </>
      );
    }
    case "wait":
      return (
        <>
          {context.reason} · source: {context.source}
        </>
      );
    case "review":
      return (
        <>
          <Ref label={`PR #${context.pullRequest.toString()}`} href={context.link} /> ·{" "}
          {reviewDetail(context)}
        </>
      );
  }
}

/** The two lines of a row of the List panel. Titles and reasons are text nodes; links come from `link` fields. */
export function PanelRow({ item }: { item: WorkItem }) {
  return (
    <div className="list-row">
      <div className="list-row-first">
        <FirstLine item={item} />
      </div>
      <div className="list-row-second muted">
        <SecondLine item={item} />
      </div>
    </div>
  );
}
