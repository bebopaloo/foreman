import type { DashResponse } from "@foreman/shared";
import {
  axisTicks,
  clock,
  dayAndClock,
  placeBuilds,
  plural,
  RESULT_COLOURS,
  RESULT_ORDER,
} from "./last-run.ts";

export function LastRun({ dash }: { dash: DashResponse | undefined }) {
  if (dash === undefined) return <p className="muted">No data yet.</p>;
  if (dash.sources.runs === "unreadable") {
    return <p className="muted">No data. See Now.</p>;
  }
  const run = dash.lastRun;
  if (run === null) return <p>No run in the last 30 days</p>;

  const lanes = placeBuilds(run);
  const ticks = axisTicks(run);
  const legend = RESULT_ORDER.filter((result) => run.builds.some((b) => b.result === result));

  return (
    <div className="last-run">
      <p className="last-run-summary">
        <span className="mono">
          run {run.runId} · {dayAndClock(run.start)} to {clock(run.end)}
        </span>
        {run.running ? <strong>Run in progress</strong> : null}
        <span>{plural(run.builds.length, "build", "builds")}</span>
        <span>{plural(run.skips, "skip", "skips")}</span>
        <span>{run.blockedAtSelection.toString()} blocked at selection</span>
      </p>
      {run.builds.length === 0 ? (
        <p className="muted">No builds in this run.</p>
      ) : (
        <>
          <div className="timeline" aria-hidden="true">
            <div className="timeline-row">
              <span />
              <div className="timeline-axis">
                {ticks.map((tick) => (
                  <span key={tick.at} className="mono" style={{ left: `${tick.left.toString()}%` }}>
                    {clock(tick.at)}
                  </span>
                ))}
              </div>
            </div>
            {lanes.map((placed, index) => (
              <div className="timeline-row" key={index}>
                <span className="mono">slot {(index + 1).toString()}</span>
                <div className="lane">
                  {placed.map(({ build, left, width }) => (
                    <div
                      key={`${build.repo}#${build.issue.toString()}`}
                      className="seg"
                      title={`${build.repo} #${build.issue.toString()}: ${build.result}`}
                      style={{
                        left: `${left.toString()}%`,
                        width: `${width.toString()}%`,
                        background: RESULT_COLOURS[build.result],
                      }}
                    >
                      {build.repo} #{build.issue} · {build.result}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ul className="legend" aria-label="Results">
            {legend.map((result) => (
              <li key={result}>
                <span className="swatch" style={{ background: RESULT_COLOURS[result] }} />
                {result}
              </li>
            ))}
          </ul>
          <table className="sr-only">
            <caption>Builds of the last run</caption>
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Repo</th>
                <th scope="col">Issue</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {run.builds.map((build) => (
                <tr key={`${build.repo}#${build.issue.toString()}`}>
                  <td>{build.lane}</td>
                  <td>{build.repo}</td>
                  <td>{build.issue}</td>
                  <td>{dayAndClock(build.start)}</td>
                  <td>{dayAndClock(build.end)}</td>
                  <td>{build.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
