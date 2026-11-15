import type {
  ReviewsPullRequest,
  ReviewsPullRequestsResponse,
  ReviewsResponse,
} from "@foreman/shared";
import { MISSING } from "../format/index.ts";
import { ShowMoreList, type PagedList } from "../list/index.ts";
import { UsageStatus } from "../usage-status/index.ts";
import { DataNotes } from "./DataNotes.tsx";
import { PullRequestRow } from "./PullRequestRow.tsx";
import { formatMinutes, plural, tierName } from "./labels.ts";

type Times = ReviewsResponse["times"];

const LEGEND = [
  ["build", "var(--agent-software-developer)"],
  ["review agents", "var(--agent-review-finder)"],
  ["resolver", "var(--agent-review-resolver)"],
  ["other", "var(--agent-other)"],
  ["review cycle", "var(--agent-review-verifier)"],
] as const;

function TierTable({ times }: { times: Times }) {
  return (
    <div className="table-scroll" role="region" aria-label="Review time by tier table" tabIndex={0}>
      <table className="matrix times-table">
        <caption className="sr-only">Review time against build time, by final tier</caption>
        <thead>
          <tr>
            {[
              "Final tier",
              "Pull requests",
              "Timed",
              "Median build",
              "Median Review cycle",
              "Mean rounds",
              "Review share",
            ].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.byTier.map((row) => (
            <tr key={row.tier ?? "none"}>
              <th scope="row" className="mono">
                {tierName(row.tier)}
              </th>
              <td>{row.pullRequests.toString()}</td>
              <td>{row.timed.toString()}</td>
              <td>{formatMinutes(row.medianBuildSeconds)}</td>
              <td>{formatMinutes(row.medianReviewCycleSeconds)}</td>
              <td>{row.meanRounds === null ? MISSING : row.meanRounds.toFixed(1)}</td>
              <td>
                {row.reviewSharePercent === null
                  ? MISSING
                  : `${row.reviewSharePercent.toString()}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Counts({ times }: { times: Times }) {
  const lines: string[] = [];
  if (times.notTimed > 0) {
    lines.push(
      `${plural(times.notTimed, "build", "builds")} not timed: its start or its settle is in another run`,
    );
  }
  if (times.noPullRequest > 0) {
    lines.push(`${plural(times.noPullRequest, "build", "builds")} with no pull request`);
  }
  if (times.noBuildEnd > 0) {
    lines.push(`${plural(times.noBuildEnd, "build", "builds")} with no build end`);
  }
  if (times.reviewAgentSpansNotLinked > 0) {
    lines.push(
      `${plural(times.reviewAgentSpansNotLinked, "review agent span", "review agent spans")} not linked: no single work item`,
    );
  }
  if (lines.length === 0) return null;
  return (
    <ul className="plain-list" aria-label="Builds that the section leaves out">
      {lines.map((line) => (
        <li key={line} className="muted">
          {line}
        </li>
      ))}
    </ul>
  );
}

export interface ReviewTimeProps {
  data: ReviewsResponse;
  list: PagedList<ReviewsPullRequest, ReviewsPullRequestsResponse>;
  onDataChanged: () => void;
}

export function ReviewTime({ data, list, onDataChanged }: ReviewTimeProps) {
  const { times } = data;
  const maxSeconds = Math.max(0, ...list.rows.map((row) => row.totalSeconds));
  return (
    <section className="card reviews-section" aria-labelledby="reviews-time">
      <div className="section-head">
        <h2 id="reviews-time">Review time against build time</h2>
        <span className="muted">source: night log, Control events and Usage index</span>
      </div>
      <UsageStatus onDataChanged={onDataChanged} />
      {times.byTier.length === 0 ? (
        <p className="muted">No timed build in 30 days.</p>
      ) : (
        <TierTable times={times} />
      )}
      <Counts times={times} />
      <p className="muted">
        The medians and the review share use the builds with a build end from an agent span. A build
        end from the first gate event leaves out the first review round, so such a row shows its
        source and counts in no aggregate.
      </p>
      <h3>Pull requests, longest total time first</h3>
      <DataNotes state={data.state} complete={data.complete} />
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The pull request list cannot be read. Reload this page to try again.
        </p>
      ) : list.isPending ? (
        <p role="status">Reading the pull requests.</p>
      ) : list.rows.length === 0 ? (
        <p className="muted">No pull request in this scope.</p>
      ) : (
        <>
          <ShowMoreList
            list={list}
            label="Pull requests"
            rowKey={(row) => `${row.repoId ?? row.repo}#${row.number.toString()}`}
            renderRow={(row) => <PullRequestRow row={row} maxSeconds={maxSeconds} />}
          />
          <ul className="legend" aria-label="Legend of the time bars">
            {LEGEND.map(([label, colour]) => (
              <li key={label}>
                <span className="swatch" style={{ background: colour }} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
