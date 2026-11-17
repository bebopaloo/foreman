import {
  FINDING_OUTCOMES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  ROLLUP_COLUMNS,
  SECURITY_PASS,
  type Finding,
  type FindingsResponse,
} from "@foreman/shared";
import { fetchFindings } from "../api.ts";
import { formatNumber } from "../format/index.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { useFindingsFilters, type FindingsKey } from "./findings-url-state.ts";
import { plural, safeLink } from "./labels.ts";

export const FINDINGS_EMPTY_TEXT =
  "No findings in the ledger. The factory writes the ledger from factory-core 0.39.0.";

function Roll({ security }: { security: FindingsResponse["security"] }) {
  const { bySeverity } = security;
  return (
    <div className="table-scroll" role="region" aria-label="Security roll-up table" tabIndex={0}>
      <table className="matrix">
        <caption className="sr-only">Security findings by severity and outcome</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            {ROLLUP_COLUMNS.map((column) => (
              <th key={column} scope="col" className="mono">
                {column}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {FINDING_SEVERITIES.map((severity) => {
            const row = bySeverity[severity];
            return (
              <tr key={severity}>
                <th scope="row" className="mono">
                  {severity}
                </th>
                {ROLLUP_COLUMNS.map((column) => (
                  <td
                    key={column}
                    className={`cell ${row[column] === 0 ? "cell-zero" : "cell-found"}`}
                  >
                    <span className="cell-count">{formatNumber(row[column])}</span>
                  </td>
                ))}
                <td className="cell cell-total">
                  <span className="cell-count">{formatNumber(row.total)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const shown = value !== "" && !options.includes(value) ? [...options, value] : options;
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">All</option>
        {shown.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

const location = (finding: Finding): string =>
  finding.file === null
    ? "no file"
    : finding.line === null
      ? finding.file
      : `${finding.file}:${finding.line.toString()}`;

function FindingRow({ finding }: { finding: Finding }) {
  const pullLink = safeLink(finding.link);
  const thread = safeLink(finding.thread);
  return (
    <tr>
      <td className="mono">{finding.repo}</td>
      <td>
        {pullLink === null ? (
          `#${finding.pr.toString()}`
        ) : (
          <a href={pullLink} rel="noopener noreferrer" target="_blank">
            #{finding.pr}
            <span className="sr-only"> pull request of {finding.repo} in the forge</span>
          </a>
        )}
      </td>
      <td>{finding.round}</td>
      <td>{finding.pass}</td>
      <td className="mono">{finding.severity}</td>
      <td className="mono">{finding.status}</td>
      <td className="mono">{finding.outcome ?? "none"}</td>
      <td className="mono">{location(finding)}</td>
      <td>
        {thread === null ? (
          "none"
        ) : (
          <a href={thread} rel="noopener noreferrer" target="_blank">
            <span aria-hidden="true">Thread ↗</span>
            <span className="sr-only">
              Review thread of pull request {finding.pr.toString()} of {finding.repo}
            </span>
          </a>
        )}
      </td>
    </tr>
  );
}

export function FindingsSection({ refreshMs }: { refreshMs: number }) {
  const { scope, clientsSettled, unknownClient } = useScope();
  const { filters, setFilter } = useFindingsFilters();
  const list = usePagedList<Finding, FindingsResponse>({
    queryKey: ["reviews", "findings", scope, filters],
    fetchPage: (cursor, signal) => fetchFindings(scope, filters, cursor, signal),
    enabled: clientsSettled && !unknownClient,
    refetchInterval: refreshMs,
  });
  const first = list.firstPage;
  const change = (key: FindingsKey) => (value: string) => {
    setFilter(key, value === "" ? null : value);
  };
  const hasFilter = Object.keys(filters).length > 0;

  return (
    <section className="card reviews-section" aria-labelledby="reviews-findings">
      <div className="section-head">
        <h2 id="reviews-findings">Findings ledger</h2>
      </div>
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The findings ledger cannot be read. The API may be stopped.
        </p>
      ) : null}
      {list.isPending ? <p role="status">Reading the findings ledger.</p> : null}
      {first === undefined ? null : (
        <>
          {first.folder === "unreadable" ? (
            <p role="alert" className="note note-warn">
              The findings ledger folder cannot be read.
            </p>
          ) : null}
          {first.skippedLines + first.skippedFiles > 0 ? (
            <p role="status" className="note note-warn">
              {plural(first.skippedLines, "line", "lines")} and{" "}
              {plural(first.skippedFiles, "file", "files")} skipped because they are not valid.
            </p>
          ) : null}
          {first.folder !== "unreadable" && first.repos.length === 0 && !hasFilter ? (
            <p className="muted">{FINDINGS_EMPTY_TEXT}</p>
          ) : (
            <>
              <h3>Security roll-up</h3>
              <Roll security={first.security} />
              <p className="muted">
                Each finding counts once, with its latest status and outcome. A refuted finding is
                refuted, whatever its outcome. A finding with no outcome is open. A dropped finding
                is not counted. The {SECURITY_PASS} pass only.
              </p>
              <div className="selects" role="group" aria-label="Findings filters">
                <Select
                  label="Repo"
                  value={filters.repo ?? ""}
                  options={first.repos}
                  onChange={change("findings_repo")}
                />
                <Select
                  label="Pass"
                  value={filters.pass ?? ""}
                  options={first.passes}
                  onChange={change("findings_pass")}
                />
                <Select
                  label="Severity"
                  value={filters.severity ?? ""}
                  options={FINDING_SEVERITIES}
                  onChange={change("findings_severity")}
                />
                <Select
                  label="Status"
                  value={filters.status ?? ""}
                  options={FINDING_STATUSES}
                  onChange={change("findings_status")}
                />
                <Select
                  label="Outcome"
                  value={filters.outcome ?? ""}
                  options={[...FINDING_OUTCOMES, "none"]}
                  onChange={change("findings_outcome")}
                />
              </div>
              <p className="muted" role="status">
                {plural(first.total, "finding", "findings")}
                {hasFilter ? " after the filters" : ""}
              </p>
              {list.rows.length === 0 ? (
                <p className="muted">No finding matches the filters.</p>
              ) : (
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Findings table"
                  tabIndex={0}
                >
                  <table className="matrix">
                    <caption className="sr-only">Findings of the last 30 days</caption>
                    <thead>
                      <tr>
                        {[
                          "Repo",
                          "Pull request",
                          "Round",
                          "Pass",
                          "Severity",
                          "Status",
                          "Outcome",
                          "File",
                          "Thread",
                        ].map((heading) => (
                          <th key={heading} scope="col">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((finding) => (
                        <FindingRow
                          key={`${finding.repo}#${finding.pr.toString()}:${finding.fingerprint}`}
                          finding={finding}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {list.hasMore ? (
                <button
                  type="button"
                  disabled={list.isLoadingMore}
                  onClick={() => {
                    void list.showMore();
                  }}
                >
                  Show more
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
