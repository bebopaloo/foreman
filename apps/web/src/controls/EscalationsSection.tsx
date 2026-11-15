import type { ControlsResponse } from "@foreman/shared";
import { ExternalLink } from "./ExternalLink.tsx";
import { Pill } from "./Pill.tsx";
import { MISSING, formatNumber, formatTime, plural, tierTone } from "./labels.ts";

type Escalations = ControlsResponse["escalations"];

function TierCell({ tier }: { tier: string | null }) {
  return tier === null ? <>{MISSING}</> : <Pill tone={tierTone(tier)}>{tier}</Pill>;
}

export function EscalationsSection({ escalations }: { escalations: Escalations }) {
  const more = escalations.total - escalations.rows.length;
  return (
    <section className="card controls-section" aria-labelledby="controls-escalations">
      <div className="controls-head">
        <h2 id="controls-escalations">Escalations</h2>
        <span className="muted">source: escalated Control events, last 30 days</span>
      </div>
      {escalations.rows.length === 0 ? (
        <p className="muted">No escalation in 30 days.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Escalations table" tabIndex={0}>
          <table className="controls-table">
            <caption className="sr-only">Escalations by repo and path</caption>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Repo</th>
                <th scope="col">Path tier</th>
                <th scope="col">Final tier</th>
                <th scope="col">Times</th>
                <th scope="col">Latest PR</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {escalations.rows.map((row) => (
                <tr key={`${row.repoId}:${row.path}`}>
                  <th scope="row" className="mono controls-path">
                    {row.path}
                  </th>
                  <td className="mono">{row.repo}</td>
                  <td>
                    <TierCell tier={row.pathTier} />
                  </td>
                  <td>
                    <TierCell tier={row.tier} />
                  </td>
                  <td>{formatNumber(row.count)}</td>
                  <td className="mono">
                    {row.latestPull === null ? (
                      MISSING
                    ) : (
                      <ExternalLink
                        href={row.latestPull.link}
                        shown={`#${row.latestPull.number.toString()}`}
                        name={`Pull request ${row.latestPull.number.toString()} of ${row.repo} in the forge`}
                      />
                    )}
                    <span className="controls-sub muted">{formatTime(row.latestAt)}</span>
                  </td>
                  <td className="mono controls-path">{row.evidence ?? MISSING}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more > 0 ? <p className="muted">and {formatNumber(more)} more</p> : null}
      {escalations.repeatedPaths > 0 ? (
        <p>
          {plural(escalations.repeatedPaths, "path", "paths")} escalated 2 or more times. Change the
          Risk map in a pull request.
        </p>
      ) : null}
    </section>
  );
}
