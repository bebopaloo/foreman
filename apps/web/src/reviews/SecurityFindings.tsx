import type { ReviewsMode, ReviewsResponse } from "@foreman/shared";
import { formatNumber } from "../format/index.ts";
import { DataNotes } from "./DataNotes.tsx";
import { EMPTY_TEXT } from "./RiskTierResults.tsx";
import { MODE_LABELS, TIERS, plural, safeLink, signalText } from "./labels.ts";

type Findings = ReviewsResponse["findings"];
type Counts = Findings["byCategory"];

const SEVERITIES = ["blocker", "major", "minor", "info"] as const;

function SeverityMatrix({ findings }: { findings: Findings }) {
  const { bySeverity, withoutMatrix } = findings.security;
  const withNone = SEVERITIES.some((severity) => (bySeverity[severity].none ?? 0) > 0);
  const columns = [...TIERS, ...(withNone ? (["none"] as const) : [])];
  return (
    <div>
      <div className="table-scroll" role="region" aria-label="Security findings table" tabIndex={0}>
        <table className="matrix">
          <caption className="sr-only">Security findings by severity and Risk tier</caption>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              {columns.map((tier) => (
                <th key={tier} scope="col" className="mono">
                  {tier === "none" ? "no tier" : tier}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {SEVERITIES.map((severity) => {
              const row = bySeverity[severity];
              return (
                <tr key={severity}>
                  <th scope="row" className="mono">
                    {severity}
                  </th>
                  {columns.map((tier) => {
                    const count = row[tier] ?? 0;
                    return (
                      <td key={tier} className={`cell ${count === 0 ? "cell-zero" : "cell-found"}`}>
                        <span className="cell-count">{formatNumber(count)}</span>
                      </td>
                    );
                  })}
                  <td className="cell cell-total">
                    <span className="cell-count">{formatNumber(row.total)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {withoutMatrix > 0 ? (
        <p className="muted">
          {plural(withoutMatrix, "pull request", "pull requests")} with no matrix: not counted
        </p>
      ) : null}
      <p className="muted">
        Rows are severities and columns are final Risk tiers. The count comes from the Security row
        of the matrix of each chosen event.
      </p>
    </div>
  );
}

function CountBars({ title, counts }: { title: string; counts: Counts }) {
  const max = Math.max(1, ...counts.map((entry) => entry.count));
  return (
    <div>
      <h4>{title}</h4>
      {counts.length === 0 ? (
        <p className="muted">None in this scope.</p>
      ) : (
        <ul className="bars" aria-label={title}>
          {counts.map((entry) => (
            <li key={entry.name}>
              <span className="mono">{entry.name}</span>
              <div className="bar" aria-hidden="true">
                <div
                  style={{
                    width: `${((entry.count / max) * 100).toString()}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <span>{formatNumber(entry.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Refs({ findings }: { findings: Findings }) {
  return (
    <div>
      <h4>Most frequent refs</h4>
      {findings.refs.length === 0 ? (
        <p className="muted">No refs in this scope.</p>
      ) : (
        <ul className="plain-list" aria-label="Most frequent refs">
          {findings.refs.map((entry) => (
            <li key={entry.ref} className="split-line">
              <span className="mono">{entry.ref}</span>
              <span>{plural(entry.pullRequests, "pull request", "pull requests")}</span>
            </li>
          ))}
        </ul>
      )}
      {findings.refsMore > 0 ? (
        <p className="muted">and {findings.refsMore.toString()} more</p>
      ) : null}
    </div>
  );
}

function Signals({
  findings,
  notes,
}: {
  findings: Findings;
  notes: Pick<ReviewsResponse, "state" | "complete">;
}) {
  return (
    <div>
      <h4>Signal: Security findings in general or inert pull requests</h4>
      <DataNotes {...notes} />
      {findings.signals.length === 0 ? (
        <p className="muted">None in this scope.</p>
      ) : (
        <ul className="plain-list" aria-label="Signals">
          {findings.signals.map((signal) => {
            const link = safeLink(signal.link);
            return (
              <li key={`${signal.repoId ?? signal.repo}#${signal.pr.toString()}`}>
                <span className="split-line">
                  <span className="mono">
                    {signal.repo} #{signal.pr}
                  </span>
                  {link === null ? null : (
                    <a href={link} rel="noopener noreferrer" target="_blank">
                      <span aria-hidden="true">PR ↗</span>
                      <span className="sr-only">
                        Pull request {signal.pr.toString()} of {signal.repo} in the forge
                      </span>
                    </a>
                  )}
                </span>
                <span className="muted">
                  {signal.tier} · {signalText(signal)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {findings.signalsMore > 0 ? (
        <p className="muted">and {findings.signalsMore.toString()} more</p>
      ) : null}
      <p className="muted">
        A Security finding in a low tier can show a path that the Risk map misses.
      </p>
    </div>
  );
}

export interface SecurityFindingsProps {
  findings: Findings;
  notes: Pick<ReviewsResponse, "state" | "complete">;
  empty: boolean;
  mode: ReviewsMode;
  onMode: (mode: ReviewsMode) => void;
}

export function SecurityFindings({ findings, notes, empty, mode, onMode }: SecurityFindingsProps) {
  const total = SEVERITIES.reduce(
    (sum, severity) => sum + findings.security.bySeverity[severity].total,
    0,
  );
  return (
    <section className="card reviews-section" aria-labelledby="reviews-security">
      <div className="section-head">
        <h2 id="reviews-security">Security findings</h2>
        <div role="group" aria-label="Which findings" className="chips">
          {(["round1", "settle"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                onMode(value);
              }}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <p className="muted">{EMPTY_TEXT}</p>
      ) : (
        <>
          <p className="muted">
            {plural(total, "Security finding", "Security findings")},{" "}
            {MODE_LABELS[mode].toLowerCase()}
          </p>
          <div className="security-grid">
            <div className="security-main">
              <SeverityMatrix findings={findings} />
              <div className="two-columns">
                <CountBars title="Findings by category" counts={findings.byCategory} />
                <CountBars title="Findings by severity" counts={findings.bySeverity} />
              </div>
            </div>
            <div className="security-side">
              <Refs findings={findings} />
              <Signals findings={findings} notes={notes} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
