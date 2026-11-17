import type { FactoryRunRow, FactoryRunsResponse, StoppedItem } from "@foreman/shared";
import { MISSING, formatTime } from "../format/index.ts";
import { ScopedLink } from "../scope/index.ts";
import { runReportPath } from "../runs/index.ts";
import type { PagedList } from "../list/index.ts";
import { ShowMore } from "./ShowMore.tsx";
import { buildsText, nightOf, peakText, plural, safeLink } from "./labels.ts";

type RunList = PagedList<FactoryRunRow, FactoryRunsResponse>;

function Stopped({ item }: { item: StoppedItem }) {
  const link = safeLink(item.link);
  return (
    <li>
      <span className="mono">
        {item.repo} #{item.issue.toString()}
      </span>
      {item.title === null ? null : ` ${item.title}`}{" "}
      <span className="muted">
        {item.resumedBy === null
          ? "not resumed yet"
          : `resumed by the run of ${nightOf(item.resumedBy)}`}
      </span>
      {link === null ? null : (
        <>
          {" "}
          <a href={link} rel="noopener noreferrer" target="_blank">
            <span aria-hidden="true">↗</span>
            <span className="sr-only">
              Issue {item.issue.toString()} of {item.repo} in the tracker
            </span>
          </a>
        </>
      )}
    </li>
  );
}

function Row({ run }: { run: FactoryRunRow }) {
  return (
    <tr>
      <th scope="row" className="mono">
        <ScopedLink to={runReportPath(run.runId)}>
          {nightOf(run.start)}
          <span className="sr-only"> report of run {run.runId}</span>
        </ScopedLink>
      </th>
      <td className="mono">
        {formatTime(run.start)}–{run.running ? "now" : formatTime(run.end)}
        {run.running ? <span className="pill pill-info health-pill">in progress</span> : null}
      </td>
      <td>{buildsText(run)}</td>
      <td>{peakText(run)}</td>
      <td>
        {run.skips === 0 && run.blockedAtSelection === 0 ? (
          MISSING
        ) : (
          <>
            {run.skips === 0 ? null : <div>{plural(run.skips, "skip", "skips")}</div>}
            {run.blockedAtSelection === 0 ? null : (
              <div>{run.blockedAtSelection.toString()} blocked at selection</div>
            )}
          </>
        )}
      </td>
      <td>
        {run.stoppedItems.length === 0 ? (
          MISSING
        ) : (
          <>
            <div>{plural(run.stoppedItems.length, "stopped item", "stopped items")}</div>
            <ul className="plain-list">
              {run.stoppedItems.map((item) => (
                <Stopped key={`${item.repoId ?? item.repo}:${item.issue.toString()}`} item={item} />
              ))}
            </ul>
          </>
        )}
      </td>
    </tr>
  );
}

export function UnattendedRuns({ list }: { list: RunList }) {
  const first = list.firstPage;
  const skippedLines = first?.skipped.nightLogLines ?? 0;
  return (
    <section className="card health-section health-wide" aria-labelledby="health-runs">
      <div className="section-head">
        <h2 id="health-runs">Unattended runs</h2>
        <span className="muted">source: night log · last 30 days</span>
      </div>
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The runs cannot be read. The API may be stopped: start it with pnpm dev, then reload this
          page.
        </p>
      ) : null}
      {list.isPending && !list.isError ? <p role="status">Reading the runs.</p> : null}
      {first?.sources.runs === "unreadable" ? (
        <p role="alert" className="note note-warn">
          cannot read the factory folder
        </p>
      ) : null}
      {skippedLines > 0 ? (
        <p className="note note-warn">
          {plural(skippedLines, "night log line", "night log lines")} skipped: not valid.
        </p>
      ) : null}
      {first === undefined || first.sources.runs === "unreadable" ? null : list.rows.length ===
        0 ? (
        <p className="muted">No run in the last 30 days</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Unattended runs table" tabIndex={0}>
          <table className="work-table health-table runs-table">
            <caption className="sr-only">Unattended runs, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Night</th>
                <th scope="col">Window</th>
                <th scope="col">Builds</th>
                <th scope="col">Peak</th>
                <th scope="col">Skips</th>
                <th scope="col">Stopped items</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((run) => (
                <Row key={run.runId} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ShowMore list={list} name="runs" />
    </section>
  );
}
