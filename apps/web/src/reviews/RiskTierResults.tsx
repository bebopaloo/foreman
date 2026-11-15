import type { ReviewsResponse } from "@foreman/shared";
import { BarChart } from "../charts/index.ts";
import { formatNumber } from "../format/index.ts";
import { NO_TIER, TIERS, plural } from "./labels.ts";

type TierResults = ReviewsResponse["tierResults"];

export const EMPTY_TEXT = "No Control events in this scope.";

export function isEmptyTierResults({ byFinalTier, merges }: TierResults): boolean {
  return Object.values(byFinalTier).every((count) => count === 0) && merges.length === 0;
}

function PathMatrix({ results }: { results: TierResults }) {
  const { cells, noTier } = results.pathAgainstFinal;
  const cellOf = (pathTier: string, finalTier: string) =>
    cells.find((cell) => cell.pathTier === pathTier && cell.finalTier === finalTier);
  return (
    <div className="matrix-block">
      <h4>Path tier (rows) against final tier (columns)</h4>
      <div
        className="table-scroll"
        role="region"
        aria-label="Path tier against final tier table"
        tabIndex={0}
      >
        <table className="matrix">
          <caption className="sr-only">Path tier against final tier</caption>
          <thead>
            <tr>
              <th scope="col">Path tier</th>
              {TIERS.map((tier) => (
                <th key={tier} scope="col" className="mono">
                  {tier}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((pathTier) => (
              <tr key={pathTier}>
                <th scope="row" className="mono">
                  {pathTier}
                </th>
                {TIERS.map((finalTier) => {
                  const cell = cellOf(pathTier, finalTier);
                  const count = cell?.count ?? 0;
                  const escalated = cell?.escalated === true && count > 0;
                  const tone =
                    count === 0 ? "zero" : pathTier === finalTier ? "diagonal" : "escalated";
                  return (
                    <td key={finalTier} className={`cell cell-${tone}`}>
                      <span className="cell-count">{formatNumber(count)}</span>
                      {escalated ? <span className="cell-label">escalated</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {noTier > 0 ? (
        <p className="muted">{plural(noTier, "pull request", "pull requests")} with no tier</p>
      ) : null}
      <p className="muted">
        The diagonal means that the Risk map gave the tier. A cell off the diagonal holds escalated
        pull requests.
      </p>
    </div>
  );
}

function Merges({ merges }: { merges: TierResults["merges"] }) {
  return (
    <div>
      <h4>Merges by base and tier</h4>
      {merges.length === 0 ? (
        <p className="muted">No merged event in 30 days.</p>
      ) : (
        <ul className="plain-list" aria-label="Merges by base and tier">
          {merges.map((merge) => (
            <li key={merge.base}>
              <span className="mono">{merge.base}</span>:{" "}
              {[...TIERS, "none" as const]
                .filter((tier) => merge[tier] > 0)
                .map((tier) => `${tier === "none" ? NO_TIER : tier} ${merge[tier].toString()}`)
                .join(", ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RiskTierResults({ results }: { results: TierResults }) {
  const { byFinalTier } = results;
  const points = [...TIERS, "none" as const].map((tier) => ({
    label: tier === "none" ? NO_TIER : tier,
    value: byFinalTier[tier],
  }));
  return (
    <section className="card reviews-section" aria-labelledby="reviews-tiers">
      <div className="section-head">
        <h2 id="reviews-tiers">Risk tier results</h2>
        <span className="muted">source: gate, escalated and merged Control events</span>
      </div>
      {isEmptyTierResults(results) ? (
        <p className="muted">{EMPTY_TEXT}</p>
      ) : (
        <>
          <BarChart
            title="Pull requests by final tier"
            valueName="Pull requests"
            labelName="Final tier"
            data={points}
            height={200}
          />
          <p className="count-line" aria-hidden="true">
            {points.map((point) => `${point.label} ${point.value.toString()}`).join(" · ")}
          </p>
          <PathMatrix results={results} />
          <Merges merges={results.merges} />
          <p className="muted">
            A path that escalates again and again shows a wrong Risk map. The Controls view lists
            the paths.
          </p>
        </>
      )}
    </section>
  );
}
