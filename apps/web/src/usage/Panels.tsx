import type { BreakdownResponse, SeriesResponse } from "@foreman/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { BarChart } from "../charts/index.ts";
import { formatEstimate, formatTokens } from "../format/index.ts";
import {
  METRIC_FORMATS,
  METRIC_NAMES,
  bucketLabel,
  metricValue,
  totalTokens,
  unpricedLines,
} from "./metric.ts";
import type { Metric } from "./url-state/index.ts";

const EMPTY = "No usage in this range in this scope.";
const FAILED = "This panel cannot load the data. Try Refresh.";

function Skeleton({ name, className }: { name: string; className: string }) {
  return <div role="status" aria-label={`Loading ${name}`} className={`skeleton ${className}`} />;
}

function Unpriced({ models }: { models: readonly { model: string; turns: number }[] }) {
  const lines = unpricedLines(models);
  if (lines.length === 0) return null;
  return (
    <ul className="unpriced">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function TokensTile({
  query,
  rangeLabel,
}: {
  query: UseQueryResult<BreakdownResponse>;
  rangeLabel: string;
}) {
  const label = `Tokens, ${rangeLabel}`;
  if (query.isPending) return <Skeleton name="the tokens tile" className="tile-skeleton" />;
  if (query.isError) {
    return (
      <section className="card tile" aria-labelledby="tile-tokens">
        <h2 id="tile-tokens" className="tile-label">
          {label}
        </h2>
        <p role="status" className="note note-warn">
          {FAILED}
        </p>
      </section>
    );
  }
  const { totals, unpricedModels, note } = query.data;
  return (
    <section className="card tile" aria-labelledby="tile-tokens">
      <h2 id="tile-tokens" className="tile-label">
        {label}
      </h2>
      {totals.turns === 0 ? (
        <p>{EMPTY}</p>
      ) : (
        <>
          <p className="tile-value">{formatTokens(totalTokens(totals))}</p>
          <p>{`List-price estimate ${formatEstimate(totals.estimate)}`}</p>
          <Unpriced models={unpricedModels} />
          <p className="muted">{note}</p>
        </>
      )}
    </section>
  );
}

export function UsageOverTime({
  query,
  metric,
  grain,
}: {
  query: UseQueryResult<SeriesResponse>;
  metric: Metric;
  grain: string;
}) {
  const name = METRIC_NAMES[metric];
  const title = `${name} by ${grain}`;
  let body;
  if (query.isPending) body = <Skeleton name="Usage over time" className="chart-skeleton" />;
  else if (query.isError) {
    body = (
      <p role="status" className="note note-warn">
        {FAILED}
      </p>
    );
  } else if (query.data.buckets.every((bucket) => bucket.turns === 0)) {
    body = <p>{EMPTY}</p>;
  } else {
    body = (
      <>
        {metric === "estimate" ? <Unpriced models={query.data.unpricedModels} /> : null}
        <BarChart
          title={title}
          valueName={name}
          formatValue={METRIC_FORMATS[metric]}
          data={query.data.buckets.map((bucket) => ({
            label: bucketLabel(bucket.start, grain),
            value: metricValue(bucket, metric),
          }))}
        />
      </>
    );
  }
  return (
    <section className="card panel" aria-labelledby="usage-over-time">
      <h2 id="usage-over-time">Usage over time</h2>
      <p className="muted">{`From the Usage index: ${name.toLowerCase()} for each ${grain}.`}</p>
      <div className="panel-body">{body}</div>
    </section>
  );
}
