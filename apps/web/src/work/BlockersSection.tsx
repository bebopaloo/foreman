import type { WorkBlocker } from "@foreman/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchWorkBlockers } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { safeHref } from "../sessions/labels.ts";

/** The dash shows this many blockers. A button shows all of them. */
export const BLOCKERS_SHOWN = 5;
const BLOCKERS_REFRESH_MS = 60_000;

const refOf = (blocker: WorkBlocker): string => `${blocker.repo} #${blocker.number.toString()}`;

function Row({ blocker }: { blocker: WorkBlocker }) {
  const href = safeHref(blocker.link);
  const attended = blocker.labels.includes("attended-only");
  const cuts = blocker.cutsOff.length;
  return (
    <li className="wait-item">
      <div className="wait-head">
        {blocker.issueState === "BLOCKED" ? (
          <span className="wait-pill wait-pill-blocked">BLOCKED</span>
        ) : (
          <span className="wait-pill">{blocker.issueState}</span>
        )}
        {attended ? <span className="wait-pill">attended-only</span> : null}
        <span className="mono">{refOf(blocker)}</span>
      </div>
      <div className="wait-title">{blocker.title}</div>
      <div className="wait-foot">
        <span className="muted">
          cuts off {cuts.toString()} ({blocker.direct.length.toString()} direct:{" "}
          {blocker.direct.map((number) => `#${number.toString()}`).join(", ")})
        </span>
        {href === null ? null : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Issue ${refOf(blocker)} in the forge`}
          >
            Issue ↗
          </a>
        )}
      </div>
    </li>
  );
}

/** The open issues that cut off the most open issues. Titles are text nodes; links come from the `link` field only. */
export function BlockersSection() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const [all, setAll] = useState(false);
  const limit = all ? null : BLOCKERS_SHOWN;
  const blockers = useQuery({
    queryKey: ["work", "blockers", scope, limit],
    queryFn: ({ signal }) => fetchWorkBlockers(scope, limit, signal),
    enabled: clientsSettled && !unknownClient,
    refetchInterval: BLOCKERS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const data = blockers.data;
  return (
    <section className="card" aria-labelledby="dash-blockers">
      <div className="wait-header">
        <h2 id="dash-blockers">Unblock first</h2>
        <span className="muted">open issues that cut off other open issues</span>
      </div>
      {blockers.isError ? (
        <p role="alert" className="note note-warn">
          The blockers cannot be read.
        </p>
      ) : data === undefined ? (
        <p className="muted">No data yet.</p>
      ) : data.total === 0 ? (
        <p className="muted">No open issue blocks another open issue in this scope.</p>
      ) : (
        <>
          <ul className="wait-list" aria-label="Issues that cut off the most">
            {data.items.map((blocker) => (
              <Row key={`${blocker.repoId}-${blocker.number.toString()}`} blocker={blocker} />
            ))}
          </ul>
          {!all && data.total > BLOCKERS_SHOWN ? (
            <p>
              <button
                type="button"
                className="stat-link"
                onClick={() => {
                  setAll(true);
                }}
              >
                Show all {data.total.toString()}
              </button>
            </p>
          ) : null}
          {all && data.total > BLOCKERS_SHOWN ? (
            <p>
              <button
                type="button"
                className="stat-link"
                onClick={() => {
                  setAll(false);
                }}
              >
                Show the first {BLOCKERS_SHOWN.toString()}
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
