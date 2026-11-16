import { RUN_ID_MAX, type DashResponse, type WorkSet } from "@foreman/shared";
import { StatButton } from "./panel-context.tsx";
import { plural } from "./last-run.ts";

interface Tile {
  label: string;
  /** The panel that the tile opens, or null for a tile with no panel. */
  set: WorkSet | null;
  /** True when the value is 1 or more and the panel can open. */
  open: boolean;
  value: string;
  sub: string;
}

const NO_VALUE = "–";

/** The four tiles of the dash. A tile with no data shows a dash and the reason. */
export function tilesOf(dash: DashResponse): Tile[] {
  const { tiles, reviewHealth, complete } = dash;
  const { firstRound } = reviewHealth;
  const runOk = (dash.lastRun?.runId.length ?? 0) <= RUN_ID_MAX;
  const many = (value: number | null) => value !== null && value >= 1;
  const noRun = "no run in the last 30 days";
  const noWaits =
    complete.connectedRepos === 0
      ? "not connected"
      : complete.missingRepos > 0
        ? "data is not complete"
        : "BLOCKED, G1, G3 and next steps";
  return [
    {
      label: "Builds in the last run",
      set: "builds",
      open: many(tiles.builds) && runOk,
      value: tiles.builds === null ? NO_VALUE : tiles.builds.toString(),
      sub: tiles.peak === null ? noRun : `peak ${tiles.peak.toString()} at one time`,
    },
    {
      label: "Merged in the last run",
      set: "merged",
      open: many(tiles.merged) && runOk,
      value: tiles.merged === null ? NO_VALUE : tiles.merged.toString(),
      sub: tiles.merged === null ? noRun : "source: night log",
    },
    {
      label: "Waits for you",
      set: "waits",
      open: many(tiles.waits),
      value: tiles.waits === null ? NO_VALUE : tiles.waits.toString(),
      sub: noWaits,
    },
    {
      label: "First-round pass",
      set: null,
      open: false,
      value: firstRound.rate === null ? NO_VALUE : `${firstRound.rate.toString()}%`,
      sub:
        firstRound.rate === null
          ? "no gate decision in 30 days"
          : `of ${plural(firstRound.total, "pull request", "pull requests")}, last 30 days`,
    },
  ];
}

function TileText({ tile }: { tile: Tile }) {
  return (
    <>
      <span className="tile-label">{tile.label}</span>
      <strong className="tile-value">{tile.value}</strong>
      <span className="tile-sub">{tile.sub}</span>
    </>
  );
}

export function Tiles({ dash }: { dash: DashResponse }) {
  return (
    <ul className="tiles" aria-label="Tiles">
      {tilesOf(dash).map((tile) => (
        <li key={tile.label} className="card tile">
          {tile.set === null ? (
            <TileText tile={tile} />
          ) : (
            <StatButton set={tile.set} enabled={tile.open}>
              <TileText tile={tile} />
            </StatButton>
          )}
        </li>
      ))}
    </ul>
  );
}
