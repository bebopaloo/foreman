import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchUsageBreakdown, fetchUsageSeries, type UsageQuery } from "../api.ts";
import { browserTimeZone, formatDay } from "../format/index.ts";
import { useScope } from "../scope/index.ts";
import { FilterBar, rangeName } from "./FilterBar.tsx";
import { TokensTile, UsageOverTime } from "./Panels.tsx";
import {
  effectiveGrain,
  localDay,
  relativeRangeValue,
  resolveRange,
  useUsageUrlState,
} from "./url-state/index.ts";
import "./usage.css";

const PANEL_KEY = ["usage", "panel"] as const;

export function UsagePage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const { state, invalid, update } = useUsageUrlState();
  const queryClient = useQueryClient();
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PANEL_KEY });
  }, [queryClient]);

  const resolved = resolveRange(state.range, localDay(new Date()));
  const { grain, tooLong } = effectiveGrain(resolved, state.grain);
  const timeZone = browserTimeZone();
  const query: UsageQuery = { ...resolved, tz: timeZone, client: scope };
  // Nothing loads until the scope is known to be a real client.
  const enabled = clientsSettled && !unknownClient;

  const totals = useQuery({
    queryKey: [...PANEL_KEY, "totals", query],
    queryFn: ({ signal }) => fetchUsageBreakdown(query, "project", 1, signal),
    enabled,
  });
  const series = useQuery({
    queryKey: [...PANEL_KEY, "series", query, grain],
    queryFn: ({ signal }) => fetchUsageSeries(query, grain, signal),
    enabled,
  });

  if (unknownClient) return null;

  const rangeLabel =
    state.range.kind === "absolute"
      ? `${formatDay(state.range.from)} to ${formatDay(state.range.to)}`
      : rangeName(relativeRangeValue(state.range));

  return (
    <>
      <h1>Usage</h1>
      <FilterBar state={state} resolved={resolved} onChange={update} onDataChanged={reload} />
      {invalid ? (
        <p role="status" className="note note-warn">
          The link has a value that is not valid. The page shows the defaults for it.
        </p>
      ) : null}
      {tooLong ? (
        <p role="status" className="note">
          The range is too long for this grain. The page shows months.
        </p>
      ) : null}
      <div className="tiles">
        <TokensTile query={totals} rangeLabel={rangeLabel} />
        {scope === null ? null : (
          <p className="note">Limit windows are plan-wide. They show only in the scope All.</p>
        )}
      </div>
      <UsageOverTime query={series} metric={state.metric} grain={grain} />
      <p className="muted">Times in {timeZone}</p>
    </>
  );
}
