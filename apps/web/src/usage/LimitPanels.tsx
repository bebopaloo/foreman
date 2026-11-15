import type { LimitsResponse } from "@foreman/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { LimitChart } from "../charts/index.ts";
import { formatRelative, formatReset, formatTime } from "../format/index.ts";
import { limitBand, limitWord } from "../thresholds/index.ts";
import { LIMIT_WINDOWS, limitSeries, type LimitWindowName } from "./limits.ts";

const FAILED = "This panel cannot load the data. Try Refresh.";
const PLAN_WIDE = "Plan-wide: all clients and Projects";

function Skeleton({ name, className }: { name: string; className: string }) {
  return <div role="status" aria-label={`Loading ${name}`} className={`skeleton ${className}`} />;
}

function LimitTile({
  window,
  name,
  query,
  now,
}: {
  window: LimitWindowName;
  name: string;
  query: UseQueryResult<LimitsResponse>;
  now: Date;
}) {
  const id = `tile-${window}`;
  const label = `${name} window`;
  if (query.isPending) return <Skeleton name={`the ${label} tile`} className="tile-skeleton" />;
  let body;
  if (query.isError) {
    body = (
      <p role="status" className="note note-warn">
        {FAILED}
      </p>
    );
  } else {
    const latest = query.data.latest[window];
    if (latest === null) body = <p>No reading</p>;
    else if (new Date(latest.resetsAt) <= now) {
      body = <p>{`The window reset at ${formatReset(latest.resetsAt, now)}. No reading since.`}</p>;
    } else {
      body = (
        <>
          <p className={`tile-value limit-${limitBand(latest.usedPercentage)}`}>
            {`${String(Math.round(latest.usedPercentage))}%`}
          </p>
          <p>{limitWord(latest.usedPercentage)}</p>
          <p>{`resets ${formatReset(latest.resetsAt, now)}`}</p>
          <p>{`latest reading ${formatTime(latest.time)}, ${formatRelative(latest.time, now)}`}</p>
        </>
      );
    }
  }
  return (
    <section className="card tile" aria-labelledby={id}>
      <h2 id={id} className="tile-label">
        {label}
      </h2>
      {body}
      <p className="muted">{PLAN_WIDE}</p>
    </section>
  );
}

/** The 5-hour tile and the 7-day tile. They show only in the scope "All". */
export function LimitTiles({ query, now }: { query: UseQueryResult<LimitsResponse>; now: Date }) {
  return (
    <>
      {LIMIT_WINDOWS.map(({ key, name }) => (
        <LimitTile key={key} window={key} name={name} query={query} now={now} />
      ))}
    </>
  );
}

function LimitHistoryChart({
  window,
  name,
  data,
  now,
  includesToday,
}: {
  window: LimitWindowName;
  name: string;
  data: LimitsResponse;
  now: Date;
  includesToday: boolean;
}) {
  const series = limitSeries(data, window, now, includesToday);
  if (series.total === 0) {
    return (
      <div className="limit-history-window">
        <h3>{`${name} windows`}</h3>
        <p>{data.latest[window] === null ? "No reading" : "No reading in this range"}</p>
      </div>
    );
  }
  const noun = series.total === 1 ? "window" : "windows";
  return (
    <div className="limit-history-window">
      <LimitChart title={`${name} windows`} data={series.points} />
      <p>{`${String(series.reachedHigh)} of the last ${String(series.total)} ${name} ${noun} reached 90% or more`}</p>
    </div>
  );
}

/** The Limit history panel: one chart for each Limit window. It shows only in the scope "All". */
export function LimitHistory({
  query,
  now,
  includesToday,
}: {
  query: UseQueryResult<LimitsResponse>;
  now: Date;
  includesToday: boolean;
}) {
  let body;
  if (query.isPending) body = <Skeleton name="Limit history" className="chart-skeleton" />;
  else if (query.isError) {
    body = (
      <p role="status" className="note note-warn">
        {FAILED}
      </p>
    );
  } else {
    const data = query.data;
    body = LIMIT_WINDOWS.map(({ key, name }) => (
      <LimitHistoryChart
        key={key}
        window={key}
        name={name}
        data={data}
        now={now}
        includesToday={includesToday}
      />
    ));
  }
  return (
    <section className="card panel" aria-labelledby="limit-history">
      <h2 id="limit-history">Limit history</h2>
      <p className="muted">
        From the Usage index: the peak of each past window. The windows are plan-wide.
      </p>
      <div className="panel-body">{body}</div>
    </section>
  );
}
