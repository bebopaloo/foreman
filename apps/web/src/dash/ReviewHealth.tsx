import { WorkSet, type DashResponse } from "@foreman/shared";
import { StatButton } from "./panel-context.tsx";
import { plural } from "./last-run.ts";
import { incompleteNote, NotConnected } from "./PipelineStrip.tsx";

type Health = DashResponse["reviewHealth"];

function Bar({ percent, colour }: { percent: number; colour: string }) {
  return (
    <div className="bar" aria-hidden="true">
      <div style={{ width: `${percent.toString()}%`, background: colour }} />
    </div>
  );
}

const ROUND_SETS = { one: "round_1", two: "round_2", three: "round_3" } as const;

const ROUND_LABELS = [
  ["one", "Round 1"],
  ["two", "Round 2"],
  ["three", "Round 3"],
] as const;

export function ReviewHealth({
  health,
  complete,
}: {
  health: Health;
  complete: DashResponse["complete"];
}) {
  const { firstRound, rounds } = health;
  const note = incompleteNote(complete);
  const nothingConnected = complete.connectedRepos === 0 && complete.missingRepos > 0;
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
              {firstRound.tiers.map((tier) => {
                const set = WorkSet.safeParse(`tier_${tier.tier ?? "none"}`);
                const row = (
                  <>
                    <span className="mono">{tier.tier ?? "no tier"}</span>
                    <Bar percent={tier.rate} colour="#1d4f9e" />
                    <span>
                      {tier.rate.toString()}% of {tier.total.toString()}
                    </span>
                  </>
                );
                return (
                  <li key={tier.tier ?? "no tier"}>
                    {set.success ? (
                      <StatButton set={set.data} enabled={tier.total >= 1}>
                        {row}
                      </StatButton>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
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
                  <StatButton set={ROUND_SETS[key]} enabled={rounds[key] >= 1}>
                    <span>{label}</span>
                    <Bar percent={Math.round((rounds[key] / pulls) * 100)} colour="#4b2a9a" />
                    <span>{rounds[key].toString()}</span>
                  </StatButton>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">round 3 that still fails moves the issue to BLOCKED</p>
        </div>
        <div>
          <h3>Control health</h3>
          <ul className="facts">
            <li>
              <StatButton set="escalated" enabled={health.escalations >= 1}>
                Escalations: {health.escalations}
              </StatButton>
            </li>
            <li>
              <StatButton set="waivers" enabled={health.waiversInUse >= 1}>
                Waivers in use: {health.waiversInUse}
              </StatButton>
            </li>
          </ul>
        </div>
      </div>
      {nothingConnected ? <NotConnected /> : null}
      {note === null ? null : <p className="note note-warn">{note}</p>}
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
