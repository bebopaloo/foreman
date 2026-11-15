import type { ReviewsPullRequest } from "@foreman/shared";
import { OUTCOME_LABELS, formatMinutes, safeLink, tierName } from "./labels.ts";

const PARTS = [
  { key: "build", label: "build", colour: "var(--agent-software-developer)" },
  { key: "agents", label: "review agents", colour: "var(--agent-review-finder)" },
  { key: "resolver", label: "resolver", colour: "var(--agent-review-resolver)" },
  { key: "other", label: "other", colour: "var(--agent-other)" },
  { key: "cycle", label: "review cycle", colour: "var(--agent-review-verifier)" },
] as const;

type PartKey = (typeof PARTS)[number]["key"];

/** The parts of the time bar, in seconds. A part with no time is left out. */
export function partsOf(row: ReviewsPullRequest): { key: PartKey; seconds: number }[] {
  const parts: { key: PartKey; seconds: number }[] = [];
  if (row.buildSeconds !== null) parts.push({ key: "build", seconds: row.buildSeconds });
  if (row.reviewCycleSeconds !== null) {
    if (row.split === null) parts.push({ key: "cycle", seconds: row.reviewCycleSeconds });
    else {
      parts.push(
        { key: "agents", seconds: row.split.reviewAgentsSeconds },
        { key: "resolver", seconds: row.split.resolverSeconds },
        { key: "other", seconds: row.split.otherSeconds },
      );
    }
  }
  return parts.filter((part) => part.seconds > 0);
}

export function roundsText(row: ReviewsPullRequest): string {
  if (row.rounds === null || row.outcome === null) return "rounds unknown";
  return `${row.rounds === 1 ? "1 round" : `${row.rounds.toString()} rounds`}, ${OUTCOME_LABELS[row.outcome]}`;
}

export function PullRequestRow({
  row,
  maxSeconds,
}: {
  row: ReviewsPullRequest;
  maxSeconds: number;
}) {
  const link = safeLink(row.link);
  const parts = partsOf(row);
  const barWidth = `${((row.totalSeconds / Math.max(maxSeconds, 1)) * 100).toString()}%`;
  const total = Math.max(
    parts.reduce((sum, part) => sum + part.seconds, 0),
    1,
  );
  return (
    <div className="pr-row">
      <div className="split-line">
        <span>
          <span className="mono">
            {row.repo} #{row.number}
          </span>{" "}
          <span className="muted">issue #{row.issue}</span>
        </span>
        {link === null ? null : (
          <a href={link} rel="noopener noreferrer" target="_blank">
            <span aria-hidden="true">PR ↗</span>
            <span className="sr-only">
              Pull request {row.number.toString()} of {row.repo} in the forge
            </span>
          </a>
        )}
      </div>
      <div className="muted">
        <span className="mono">{tierName(row.finalTier)}</span>
        {row.escalated ? ` · escalated from ${tierName(row.pathTier)}` : null} · {roundsText(row)}
      </div>
      <div className="time-bar" style={{ width: barWidth }} aria-hidden="true">
        {parts.length === 0 ? (
          <div style={{ flexGrow: 1, background: "var(--agent-other)" }} />
        ) : (
          parts.map((part) => (
            <div
              key={part.key}
              style={{
                width: `${((part.seconds / total) * 100).toString()}%`,
                background: PARTS.find((entry) => entry.key === part.key)?.colour ?? "",
              }}
            />
          ))
        )}
      </div>
      <div className="muted">
        {row.buildSeconds === null ? (
          <>no build end · total {formatMinutes(row.totalSeconds)}</>
        ) : (
          <>
            build {formatMinutes(row.buildSeconds)}
            {row.reviewCycleSeconds === null
              ? null
              : row.split === null
                ? ` · review cycle ${formatMinutes(row.reviewCycleSeconds)}`
                : ` · review agents ${formatMinutes(row.split.reviewAgentsSeconds)} · resolver ${formatMinutes(row.split.resolverSeconds)} · other ${formatMinutes(row.split.otherSeconds)}`}
            {` · total ${formatMinutes(row.totalSeconds)}`}
            {row.buildEndSource === null ? null : ` · build end: ${row.buildEndSource}`}
          </>
        )}
      </div>
    </div>
  );
}
