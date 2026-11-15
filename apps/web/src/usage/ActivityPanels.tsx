import type { BreakdownResponse, SeriesResponse } from "@foreman/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { ActivityCalendar, type CalendarDay } from "../charts/index.ts";
import { formatDay, formatEstimate, formatNumber, formatTokens } from "../format/index.ts";
import { bucketsByDay, calendarStart, daysFrom, monthOutlook } from "./activity.ts";
import { METRIC_NAMES, metricValue, unpricedLines } from "./metric.ts";
import type { Day, Metric } from "./url-state/index.ts";

const FAILED = "This panel cannot load the data. Try Refresh.";
const EMPTY = "No usage in this range in this scope.";

function Skeleton({ name, className }: { name: string; className: string }) {
  return <div role="status" aria-label={`Loading ${name}`} className={`skeleton ${className}`} />;
}

function Failed() {
  return (
    <p role="status" className="note note-warn">
      {FAILED}
    </p>
  );
}

function valueText(value: number, metric: Metric): string {
  if (metric === "tokens") return `${formatTokens(value)} tokens`;
  if (metric === "turns") return `${formatNumber(value)} ${value === 1 ? "turn" : "turns"}`;
  return formatEstimate(value);
}

export function ActivityCalendarPanel({
  query,
  metric,
  today,
}: {
  query: UseQueryResult<SeriesResponse>;
  metric: Metric;
  today: Day;
}) {
  let body;
  if (query.isPending) body = <Skeleton name="Activity calendar" className="calendar-skeleton" />;
  else if (query.isError) body = <Failed />;
  else if (query.data.buckets.every((bucket) => bucket.turns === 0)) {
    body = <p>No usage in the last 26 weeks in this scope.</p>;
  } else {
    const byDay = bucketsByDay(query.data.buckets);
    const days = daysFrom(calendarStart(today), today).map((day): CalendarDay => {
      const bucket = byDay.get(day);
      const value = bucket === undefined ? 0 : metricValue(bucket, metric);
      return { day, value, name: `${formatDay(day)}: ${valueText(value, metric)}` };
    });
    body = (
      <>
        <ActivityCalendar
          days={days}
          title={`${METRIC_NAMES[metric]} per day in the last 26 weeks`}
        />
      </>
    );
  }
  return (
    <section className="card panel" aria-labelledby="activity-calendar">
      <h2 id="activity-calendar">Activity calendar</h2>
      <p className="muted">
        From the Usage index. Last 26 weeks. This panel ignores the date range.
      </p>
      <div className="panel-body calendar-body">{body}</div>
    </section>
  );
}

export function CacheEfficiency({ query }: { query: UseQueryResult<BreakdownResponse> }) {
  let body;
  if (query.isPending) body = <Skeleton name="Cache efficiency" className="cache-skeleton" />;
  else if (query.isError) body = <Failed />;
  else {
    const { totals } = query.data;
    const input = totals.inputTokens + totals.cacheWriteTokens + totals.cacheReadTokens;
    if (totals.turns === 0) body = <p>{EMPTY}</p>;
    else if (input === 0) body = <p>No input tokens in this range.</p>;
    else {
      const ratio = Math.round((totals.cacheReadTokens / input) * 100);
      body = (
        <>
          <p className="tile-value">{`Cache hit ratio ${String(ratio)}%`}</p>
          <p>{`${formatTokens(totals.cacheReadTokens)} input tokens came from the cache`}</p>
        </>
      );
    }
  }
  return (
    <section className="card panel" aria-labelledby="cache-efficiency">
      <h2 id="cache-efficiency">Cache efficiency</h2>
      <p className="muted">
        From the Usage index. The share of input tokens that the cache gave, over the range.
      </p>
      <div className="panel-body small-body">{body}</div>
    </section>
  );
}

export function MonthOutlook({
  query,
  today,
}: {
  query: UseQueryResult<SeriesResponse>;
  today: Day;
}) {
  let body;
  if (query.isPending) body = <Skeleton name="Month outlook" className="cache-skeleton" />;
  else if (query.isError) body = <Failed />;
  else {
    const outlook = monthOutlook(query.data.buckets, today);
    if (outlook.turns === 0) body = <p>No usage so far this month in this scope.</p>;
    else {
      const last = formatDay(outlook.lastDay).split(" ").slice(0, 2).join(" ");
      body = (
        <>
          <p className="tile-value">{`${formatEstimate(outlook.soFar)} so far this month`}</p>
          <p>{`Projection to ${last}: ${formatEstimate(outlook.projection)}`}</p>
          <ul className="unpriced">
            {unpricedLines(query.data.unpricedModels).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      );
    }
  }
  return (
    <section className="card panel" aria-labelledby="month-outlook">
      <h2 id="month-outlook">Month outlook</h2>
      <p className="muted">
        The projection takes the average per day so far this month, times the days of the month.
        This panel ignores the date range.
      </p>
      <div className="panel-body small-body">{body}</div>
    </section>
  );
}
