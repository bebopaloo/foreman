import type { WorkItem, WorkItemsResponse } from "@foreman/shared";
import { useEffect, useRef, useState } from "react";
import { MISSING } from "../format/index.ts";
import type { PagedList } from "../list/index.ts";
import {
  gateLabel,
  gateTone,
  itemKey,
  notInWorkCache,
  priorityLabel,
  safeLink,
  stateLabel,
  stateTone,
  tierTone,
} from "./labels.ts";

type WorkList = PagedList<WorkItem, WorkItemsResponse>;

const GATE_HELP =
  "The factory/machine-gate status of the head commit. (event): the newest gate Control event, when the forge has no status for the head commit.";

function Pill({ tone, children }: { tone: string; children: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function ItemLink({ href, shown, name }: { href: string | null; shown: string; name: string }) {
  const safe = safeLink(href);
  if (safe === null) return null;
  return (
    <a href={safe} rel="noopener noreferrer" target="_blank">
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{name}</span>
    </a>
  );
}

function Row({ item }: { item: WorkItem }) {
  const { issue, pullRequest: pr } = item;
  const uncached = notInWorkCache(item);
  const title = uncached ? null : (issue?.title ?? pr?.title ?? MISSING);
  const issueNumber = issue?.number ?? (item.context?.kind === "build" ? item.context.issue : null);
  const prNumber =
    pr?.number ?? (item.context?.kind === "review" ? item.context.pullRequest : null);
  const gate = gateLabel(item);
  const stale = issue?.stale === true || pr?.stale === true;
  return (
    <>
      <td className="mono">{item.fullName}</td>
      <td className="mono">{issueNumber === null ? MISSING : `#${issueNumber.toString()}`}</td>
      <td className="work-title">
        {title ?? <span className="marker">not in the Work cache</span>}
        {stale ? <span className="marker">not in the last fetch</span> : null}
      </td>
      <td>
        <Pill tone={issue ? stateTone(issue.issueState) : "plain"}>{stateLabel(item)}</Pill>
      </td>
      <td className="mono">{issue?.type ?? MISSING}</td>
      <td>{priorityLabel(item)}</td>
      <td className="mono">
        {prNumber === null ? MISSING : `#${prNumber.toString()}`}
        {pr?.draft ? <span className="marker">draft</span> : null}
        {pr && pr.otherCount > 0 ? (
          <span className="marker">{pr.otherCount.toString()} more</span>
        ) : null}
      </td>
      <td>{pr?.checks ?? MISSING}</td>
      <td>
        {item.machineGate && gate ? (
          <Pill tone={gateTone(item.machineGate.value)}>{gate}</Pill>
        ) : (
          MISSING
        )}
      </td>
      <td>{item.round === null ? MISSING : item.round.toString()}</td>
      <td>
        {item.riskTier === null ? (
          MISSING
        ) : (
          <Pill tone={tierTone(item.riskTier)}>{item.riskTier}</Pill>
        )}
      </td>
      <td className="work-links">
        {issue && !uncached ? (
          <ItemLink
            href={issue.link}
            shown="Issue ↗"
            name={`Issue ${issue.number.toString()} of ${item.fullName} in the tracker`}
          />
        ) : null}
        {pr && !uncached ? (
          <ItemLink
            href={pr.link}
            shown="PR ↗"
            name={`Pull request ${pr.number.toString()} of ${item.fullName} in the forge`}
          />
        ) : null}
      </td>
    </>
  );
}

export function WorkTable({ list }: { list: WorkList }) {
  const [announcement, setAnnouncement] = useState("");
  const [failed, setFailed] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const focusIndex = useRef<number | null>(null);
  const rowElements = useRef<Map<number, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (focusIndex.current === null) return;
    const row = rowElements.current.get(focusIndex.current);
    if (row) {
      row.focus();
      focusIndex.current = null;
    }
  }, [focusTick, list.rows.length]);

  async function onShowMore() {
    const before = list.rows.length;
    setFailed(false);
    const added = await list.showMore();
    if (added === 0) {
      setFailed(true);
      return;
    }
    setAnnouncement(`${added.toString()} more rows shown`);
    focusIndex.current = before;
    setFocusTick((tick) => tick + 1);
  }

  return (
    <div>
      <div
        className="table-scroll"
        role="region"
        aria-label="Issues and pull requests table"
        tabIndex={0}
      >
        <table className="work-table">
          <caption className="sr-only">Issues and pull requests</caption>
          <thead>
            <tr>
              {["Repo", "Issue", "Title", "State", "Type", "Priority", "PR", "CI"].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
              <th scope="col" aria-describedby="gate-help" title={GATE_HELP}>
                Machine gate
                <span id="gate-help" className="sr-only">
                  {GATE_HELP}
                </span>
              </th>
              <th scope="col">Round</th>
              <th scope="col">Risk tier</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((item, index) => (
              <tr
                key={itemKey(item)}
                tabIndex={-1}
                ref={(element) => {
                  if (element) rowElements.current.set(index, element);
                  else rowElements.current.delete(index);
                }}
              >
                <Row item={item} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.hasMore ? (
        <button type="button" onClick={() => void onShowMore()} disabled={list.isLoadingMore}>
          Show more
        </button>
      ) : null}
      {failed ? (
        <p role="alert">The next rows did not load. Select Show more to try again.</p>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
