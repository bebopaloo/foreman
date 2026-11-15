import type { ReviewsResponse } from "@foreman/shared";
import { formatNumber } from "../format/index.ts";
import { plural } from "./labels.ts";

interface Tile {
  label: string;
  value: string;
  sub: string;
}

const NO_VALUE = "–";

/** The four tiles of the Reviews view. A tile with no data shows a dash and the reason. */
export function tilesOf({ tiles }: ReviewsResponse): Tile[] {
  const { pullRequestsReviewed, firstRoundPass, escalationRate, reviewShare } = tiles;
  return [
    {
      label: "Pull requests reviewed",
      value: formatNumber(pullRequestsReviewed.count),
      sub: "last 30 days",
    },
    {
      label: "First-round pass",
      value: firstRoundPass.percent === null ? NO_VALUE : `${firstRoundPass.percent.toString()}%`,
      sub:
        firstRoundPass.percent === null
          ? "no gate decision in 30 days"
          : `of ${plural(firstRoundPass.total, "pull request", "pull requests")}`,
    },
    {
      label: "Escalation rate",
      value: escalationRate.percent === null ? NO_VALUE : `${escalationRate.percent.toString()}%`,
      sub:
        escalationRate.percent === null
          ? "no tier in 30 days"
          : `of ${plural(escalationRate.withTier, "pull request", "pull requests")} with a tier`,
    },
    {
      label: "Review share of total time",
      value: reviewShare.percent === null ? NO_VALUE : `${reviewShare.percent.toString()}%`,
      sub:
        reviewShare.percent === null
          ? "no timed build in 30 days"
          : `of ${plural(reviewShare.builds, "build", "builds")}`,
    },
  ];
}

export function Tiles({ data }: { data: ReviewsResponse }) {
  return (
    <ul className="tiles" aria-label="Tiles">
      {tilesOf(data).map((tile) => (
        <li key={tile.label} className="card tile">
          <span className="tile-label">{tile.label}</span>
          <strong className="tile-value">{tile.value}</strong>
          <span className="tile-sub">{tile.sub}</span>
        </li>
      ))}
    </ul>
  );
}
