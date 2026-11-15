import type { DashResponse, WaitItem } from "@foreman/shared";
import { safeHref } from "../sessions/labels.ts";
import { incompleteNote, NotConnected } from "./PipelineStrip.tsx";

const KIND_LABELS: Record<WaitItem["kind"], { pill: string; link: string }> = {
  blocked: { pill: "BLOCKED", link: "Issue" },
  release: { pill: "G3 Release", link: "Release PR" },
  merge_ready: { pill: "G3 Merge-ready", link: "Issue" },
  todo: { pill: "Next step", link: "Issue" },
};

const refOf = (item: WaitItem): string =>
  `${item.repo} ${item.kind === "release" ? "PR " : ""}#${item.number.toString()}`;

function Item({ item }: { item: WaitItem }) {
  const labels = KIND_LABELS[item.kind];
  const href = safeHref(item.link);
  return (
    <li className="wait-item">
      <div className="wait-head">
        <span className={`wait-pill wait-pill-${item.kind}`}>{labels.pill}</span>
        <span className="mono">{refOf(item)}</span>
      </div>
      <div className="wait-title">{item.title}</div>
      <div className="muted">{item.reason}</div>
      <div className="wait-foot">
        <span className="muted">source: {item.source}</span>
        {href === null ? null : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${labels.link} ${refOf(item)} in the forge`}
          >
            {labels.link} ↗
          </a>
        )}
      </div>
    </li>
  );
}

/** The items that wait for the Operator. Titles and reasons are text nodes; links come from the `link` field only. */
export function WaitsForYou({ dash }: { dash: DashResponse | undefined }) {
  const waits = dash?.waits;
  const note = dash === undefined ? null : incompleteNote(dash.complete);
  return (
    <section className="card" aria-labelledby="dash-waits">
      <div className="wait-header">
        <h2 id="dash-waits">Waits for you</h2>
        <span className="muted">run factory-next to act</span>
      </div>
      {waits === undefined ? (
        <p className="muted">No data yet.</p>
      ) : waits === null ? (
        <NotConnected />
      ) : (
        <>
          {note === null ? null : <p className="note note-warn">{note}</p>}
          {waits.total === 0 ? (
            <p className="muted">Nothing waits for you in this scope.</p>
          ) : (
            <ul className="wait-list" aria-label="Items that wait for you">
              {waits.items.map((item) => (
                <Item key={`${item.kind}-${item.repoId}-${item.number.toString()}`} item={item} />
              ))}
            </ul>
          )}
          {waits.total > waits.items.length ? (
            <p className="muted">and {(waits.total - waits.items.length).toString()} more</p>
          ) : null}
        </>
      )}
    </section>
  );
}
