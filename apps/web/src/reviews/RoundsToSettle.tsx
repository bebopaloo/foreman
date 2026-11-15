import type { ReviewsResponse } from "@foreman/shared";
import { EMPTY_TEXT } from "./RiskTierResults.tsx";
import { plural, tierName } from "./labels.ts";

type Row = ReviewsResponse["rounds"][number];

const SEGMENTS = [
  { key: "round1", label: "round 1", colour: "var(--ok)" },
  { key: "round2", label: "round 2", colour: "var(--accent)" },
  { key: "round3", label: "round 3", colour: "var(--warn)" },
  { key: "blocked", label: "BLOCKED", colour: "var(--danger)" },
  { key: "notSettled", label: "not settled", colour: "var(--agent-other)" },
] as const;

function valuesOf(row: Row): Record<(typeof SEGMENTS)[number]["key"], number> {
  return {
    round1: row.settledInRound[0],
    round2: row.settledInRound[1],
    round3: row.settledInRound[2],
    blocked: row.blocked,
    notSettled: row.notSettled,
  };
}

function RoundsRow({ row }: { row: Row }) {
  const values = valuesOf(row);
  return (
    <li className="rounds-row">
      <div className="rounds-head">
        <span className="mono">
          {tierName(row.tier)} · {plural(row.pullRequests, "pull request", "pull requests")}
        </span>
        <span className="muted">
          {SEGMENTS.map((segment) => `${segment.label}: ${values[segment.key].toString()}`).join(
            " · ",
          )}
        </span>
      </div>
      <div className="stack-bar" aria-hidden="true">
        {SEGMENTS.map((segment) => (
          <div
            key={segment.key}
            style={{
              width: `${((values[segment.key] / Math.max(row.pullRequests, 1)) * 100).toString()}%`,
              background: segment.colour,
            }}
          />
        ))}
      </div>
      <span className="muted">
        {row.lastGatePassPercent === null
          ? "last-gate pass: no decision"
          : `last-gate pass: ${row.lastGatePassPercent.toString()}% of ${row.withDecision.toString()}`}
      </span>
    </li>
  );
}

export function RoundsToSettle({ rounds, empty }: { rounds: Row[]; empty: boolean }) {
  return (
    <section className="card reviews-section" aria-labelledby="reviews-rounds">
      <div className="section-head">
        <h2 id="reviews-rounds">Rounds to settle, by final tier</h2>
        <span className="muted">source: gate Control events (round, decision)</span>
      </div>
      {empty || rounds.length === 0 ? (
        <p className="muted">{EMPTY_TEXT}</p>
      ) : (
        <>
          <ul className="plain-list" aria-label="Rounds to settle by final tier">
            {rounds.map((row) => (
              <RoundsRow key={row.tier ?? "none"} row={row} />
            ))}
          </ul>
          <ul className="legend" aria-label="Legend">
            {SEGMENTS.map((segment) => (
              <li key={segment.key}>
                <span
                  className="swatch"
                  style={{ background: segment.colour }}
                  aria-hidden="true"
                />
                {segment.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
