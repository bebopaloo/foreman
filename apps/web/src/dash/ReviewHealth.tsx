import type { DashResponse } from "@foreman/shared";
import { plural } from "./last-run.ts";

type Health = DashResponse["reviewHealth"];

function Bar({ percent, colour }: { percent: number; colour: string }) {
  return (
    <div className="bar" aria-hidden="true">
      <div style={{ width: `${percent.toString()}%`, background: colour }} />
    </div>
  );
}

const ROUND_LABELS = [
  ["one", "Round 1"],
  ["two", "Round 2"],
  ["three", "Round 3"],
] as const;

export function ReviewHealth({ health }: { health: Health }) {
  const { firstRound, rounds } = health;
  const pulls = rounds.one + rounds.two + rounds.three;
  return (
    <div className="review-health">
      <p>
        <strong>First-round pass:</strong>{" "}
        {firstRound.rate === null ? (
          "no gate decision in 30 days"
        ) : (
          <>
            {firstRound.rate.toString()}% of{" "}
            {plural(firstRound.total, "pull request", "pull requests")}
          </>
        )}
      </p>
      <div className="review-grid">
        <div>
          <h3>Machine gate, last 30 days</h3>
          {firstRound.tiers.length === 0 ? (
            <p className="muted">No gate decision in 30 days.</p>
          ) : (
            <ul className="bars" aria-label="First-round pass by Risk tier">
              {firstRound.tiers.map((tier) => (
                <li key={tier.tier ?? "no tier"}>
                  <span className="mono">{tier.tier ?? "no tier"}</span>
                  <Bar percent={tier.rate} colour="#1d4f9e" />
                  <span>
                    {tier.rate.toString()}% of {tier.total.toString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">first-round pass rate by Risk tier</p>
        </div>
        <div>
          <h3>Review rounds per pull request</h3>
          {pulls === 0 ? (
            <p className="muted">No gate event in 30 days.</p>
          ) : (
            <ul className="bars" aria-label="Pull requests by highest round">
              {ROUND_LABELS.map(([key, label]) => (
                <li key={key}>
                  <span>{label}</span>
                  <Bar percent={Math.round((rounds[key] / pulls) * 100)} colour="#4b2a9a" />
                  <span>{rounds[key].toString()}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">round 3 that still fails moves the issue to BLOCKED</p>
        </div>
        <div>
          <h3>Control health</h3>
          <ul className="facts">
            <li>Escalations: {health.escalations}</li>
            <li>Waivers in use: {health.waiversInUse}</li>
          </ul>
        </div>
      </div>
      {health.reposWithoutControls.length === 0 ? null : (
        <ul className="no-controls" aria-label="Repos with no Control events">
          {health.reposWithoutControls.map((repo) => (
            <li key={repo.repoId}>
              <span className="mono">{repo.repo}</span>: no Control events in 30 days
              {!health.factoryLoginSet ? (
                <span>. Factory identity login not set</span>
              ) : repo.reviewed === null || repo.unreviewed === null ? null : (
                <span>
                  . {plural(repo.reviewed, "factory pull request", "factory pull requests")}{" "}
                  reviewed by the Factory identity,{" "}
                  {plural(repo.unreviewed, "factory pull request", "factory pull requests")} with no
                  Factory identity review
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
