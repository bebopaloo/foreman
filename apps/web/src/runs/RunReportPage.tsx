import { useQuery } from "@tanstack/react-query";
import type { RunReportResponse } from "@foreman/shared";
import { ApiStatusError, fetchRunReport } from "../api.ts";
import { BarChart } from "../charts/index.ts";
import { formatDate, formatTime } from "../format/index.ts";
import { ScopedLink, useScope } from "../scope/index.ts";
import "./runs.css";

const PREFIX = "/runs/";

/** The run ID of a path such as `/runs/<run ID>`, or null for any other path. */
export function runIdOf(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** The path of the report page of one run. */
export const runReportPath = (runId: string): string => `${PREFIX}${encodeURIComponent(runId)}`;

const plural = (count: number, one: string, many: string): string =>
  `${count.toString()} ${count === 1 ? one : many}`;

/** The last part of a repo folder or `owner/name`. */
const repoName = (repo: string): string =>
  repo
    .split("/")
    .filter((part) => part.length > 0)
    .at(-1) ?? repo;

const countsText = (counts: Record<string, number>): string => {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count.toString()} ${severity}`);
  return parts.length === 0 ? "no findings" : parts.join(", ");
};

function StateChanges({ report }: { report: RunReportResponse }) {
  return (
    <section className="card" aria-labelledby="run-changes">
      <h2 id="run-changes">State changes</h2>
      {report.stateChanges.length === 0 ? (
        <p className="muted">No state change in this run.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="State changes table" tabIndex={0}>
          <table className="work-table">
            <caption className="sr-only">State changes of the run, oldest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Issue</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.stateChanges.map((change, index) => (
                <tr
                  key={`${change.time}-${repoName(change.repo)}-${change.issue.toString()}-${index.toString()}`}
                >
                  <td className="mono">{formatTime(change.time)}</td>
                  <td className="mono">
                    {repoName(change.repo)} #{change.issue.toString()}
                  </td>
                  <td>{change.from}</td>
                  <td>{change.to}</td>
                  <td>{change.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Merges({ report }: { report: RunReportResponse }) {
  return (
    <section className="card" aria-labelledby="run-merges">
      <h2 id="run-merges">Merges</h2>
      {report.merges.length === 0 ? (
        <p className="muted">No merge in this run.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Merges table" tabIndex={0}>
          <table className="work-table">
            <caption className="sr-only">Merges of the run</caption>
            <thead>
              <tr>
                <th scope="col">Issue</th>
                <th scope="col">Pull request</th>
                <th scope="col">Tier</th>
                <th scope="col">Final gate</th>
              </tr>
            </thead>
            <tbody>
              {report.merges.map((merge) => (
                <tr key={`${merge.repo}-${merge.issue.toString()}-${(merge.pr ?? 0).toString()}`}>
                  <td className="mono">
                    {repoName(merge.repo)} #{merge.issue.toString()}
                  </td>
                  <td className="mono">{merge.pr === null ? "–" : `#${merge.pr.toString()}`}</td>
                  <td>{merge.tier ?? "not recorded"}</td>
                  <td>
                    {merge.round === null
                      ? "no gate event"
                      : `round ${merge.round.toString()}: ${countsText(merge.counts)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Blocked({ report }: { report: RunReportResponse }) {
  return (
    <section className="card" aria-labelledby="run-blocked">
      <h2 id="run-blocked">BLOCKED items</h2>
      {report.blocked.length === 0 ? (
        <p className="muted">No item became BLOCKED in this run.</p>
      ) : (
        <ul className="plain-list" aria-label="BLOCKED items">
          {report.blocked.map((item) => (
            <li key={`${item.repo}-${item.issue.toString()}-${item.time}`}>
              <span className="mono">
                {repoName(item.repo)} #{item.issue.toString()}
              </span>{" "}
              {item.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Skips({ report }: { report: RunReportResponse }) {
  const { skips } = report;
  return (
    <section className="card" aria-labelledby="run-skips">
      <h2 id="run-skips">Skips</h2>
      {skips.total === 0 ? (
        <p className="muted">No skip in this run.</p>
      ) : (
        <>
          <p>{plural(skips.total, "skip", "skips")}</p>
          {skips.byBlocker.length === 0 ? null : (
            <ul className="plain-list" aria-label="Skips by blocker">
              {skips.byBlocker.map((group) => (
                <li key={`${group.repo}#${group.blocker.toString()}`}>
                  <span className="mono">
                    {repoName(group.repo)} #{group.blocker.toString()}
                  </span>{" "}
                  blocked {plural(group.issues.length, "issue", "issues")}:{" "}
                  <span className="mono">
                    {group.issues.map((n) => `#${n.toString()}`).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {skips.other.length === 0 ? null : (
            <ul className="plain-list" aria-label="Other skips">
              {skips.other.map((skip) => (
                <li key={`${skip.repo}-${skip.issue.toString()}-${skip.reason}`}>
                  <span className="mono">
                    {repoName(skip.repo)} #{skip.issue.toString()}
                  </span>{" "}
                  {skip.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Summary({ report }: { report: RunReportResponse }) {
  return (
    <section className="card" aria-labelledby="run-summary">
      <h2 id="run-summary">Summary</h2>
      {report.summary === null ? (
        <p className="muted">This run has no summary file.</p>
      ) : (
        // Plain text: React escapes it, and no markup is built from the file.
        <pre className="run-summary-text" aria-label={`Summary file ${report.summary.file}`}>
          {report.summary.text}
        </pre>
      )}
    </section>
  );
}

function SlotUse({ report }: { report: RunReportResponse }) {
  const { slotUse } = report;
  return (
    <section className="card" aria-labelledby="run-slots">
      <h2 id="run-slots">Slot use</h2>
      <p>
        Average busy slots: <strong>{slotUse.average.toFixed(2)}</strong> of{" "}
        {slotUse.slotLimit.toString()} over {plural(slotUse.minutes, "minute", "minutes")} and{" "}
        {plural(slotUse.builds, "build", "builds")}.
      </p>
      <BarChart
        title="Minutes at each busy slot count"
        valueName="Minutes"
        labelName="Busy slots"
        data={slotUse.minutesAtCount.map((minutes, count) => ({
          label: count.toString(),
          value: minutes,
        }))}
      />
    </section>
  );
}

export function RunReportPage({ runId }: { runId: string }) {
  const { clientsSettled, unknownClient } = useScope();
  const report = useQuery({
    queryKey: ["run-report", runId],
    queryFn: ({ signal }) => fetchRunReport(runId, signal),
    enabled: clientsSettled && !unknownClient,
    retry: false,
  });

  if (unknownClient) return null;
  const heading = <h1>Run report</h1>;
  if (report.isError) {
    const missing = report.error instanceof ApiStatusError && report.error.status === 404;
    return (
      <>
        {heading}
        <p role="status" className="note note-warn">
          {missing
            ? "No run with this ID in the night log of the last 30 days."
            : "The run report cannot be read. The API may be stopped: start it with pnpm dev, then reload this page."}
        </p>
        <p>
          <ScopedLink to="/health">Back to Factory health</ScopedLink>
        </p>
      </>
    );
  }
  if (!report.isSuccess) {
    return (
      <>
        {heading}
        <p role="status">Reading the run.</p>
      </>
    );
  }
  const data = report.data;
  return (
    <div className="run-report">
      <h1>Run report</h1>
      <p className="mono">
        {data.runId} · {formatDate(data.start)} {formatTime(data.start)} to {formatTime(data.end)}
      </p>
      <p>
        <ScopedLink to="/health">Back to Factory health</ScopedLink>
      </p>
      <SlotUse report={data} />
      <Summary report={data} />
      <Merges report={data} />
      <Blocked report={data} />
      <Skips report={data} />
      <StateChanges report={data} />
      {data.skippedLines > 0 ? (
        <p className="note note-warn">
          {plural(data.skippedLines, "night log line", "night log lines")} skipped: not valid.
        </p>
      ) : null}
    </div>
  );
}
