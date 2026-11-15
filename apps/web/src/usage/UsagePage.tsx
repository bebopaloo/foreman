import type { UsageProject } from "@foreman/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  fetchUsageBreakdown,
  fetchUsageLimits,
  fetchUsageSeries,
  type UsageQuery,
} from "../api.ts";
import { browserTimeZone, formatDay } from "../format/index.ts";
import { ScopedLink, useScope } from "../scope/index.ts";
import { DimensionPanel } from "./DimensionPanel.tsx";
import { rowLimit, UNASSIGNED } from "./dimension.ts";
import { FilterBar, rangeName } from "./FilterBar.tsx";
import { ActivityCalendarPanel, CacheEfficiency, MonthOutlook } from "./ActivityPanels.tsx";
import { calendarStart, monthStart } from "./activity.ts";
import { LimitHistory, LimitTiles } from "./LimitPanels.tsx";
import { limitsTo } from "./limits.ts";
import { TokensTile, UsageOverTime } from "./Panels.tsx";
import {
  addDays,
  effectiveGrain,
  localDay,
  relativeRangeValue,
  resolveRange,
  USAGE_TABS,
  useUsageUrlState,
  writeUsageUrl,
  type UsageTab,
  type UsageUrlState,
} from "./url-state/index.ts";
import "./usage.css";

const PANEL_KEY = ["usage", "panel"] as const;

/** The tabs of a Project page: all of the tabs of the page "All Projects" but Project. */
export const PROJECT_TABS: readonly UsageTab[] = USAGE_TABS.filter((tab) => tab !== "project");

/** The path with the range, the grain and the metric of the page. The tab is the default of the target. */
function pathWithState(path: string, state: UsageUrlState): string {
  const params = new URLSearchParams(writeUsageUrl("", state));
  params.delete("tab");
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

/** The page "All Projects" of `/usage`, and the page of one Project when `project` is set. */
export function UsageView({ project = null }: { project?: UsageProject | null }) {
  const tabs = project === null ? USAGE_TABS : PROJECT_TABS;
  const { scope, clientsSettled, unknownClient } = useScope();
  const { state, invalid, update } = useUsageUrlState(tabs);
  const queryClient = useQueryClient();
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PANEL_KEY });
  }, [queryClient]);

  const now = new Date();
  const today = localDay(now);
  const resolved = resolveRange(state.range, today);
  const { grain, tooLong } = effectiveGrain(resolved, state.grain);
  const timeZone = browserTimeZone();
  const query: UsageQuery = {
    ...resolved,
    tz: timeZone,
    client: scope,
    ...(project === null ? {} : { project: project.id }),
  };
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

  const dimension = useQuery({
    queryKey: [...PANEL_KEY, "dimension", query, state.tab],
    queryFn: ({ signal }) => fetchUsageBreakdown(query, state.tab, rowLimit(state.tab), signal),
    enabled,
  });

  // Limit windows are plan-wide: a client scope sends no request to /limits.
  const limitsQuery = {
    from: resolved.from,
    to: limitsTo(resolved.to, today, addDays(today, 7)),
    tz: timeZone,
  };
  const limits = useQuery({
    queryKey: [...PANEL_KEY, "limits", limitsQuery],
    queryFn: ({ signal }) => fetchUsageLimits(limitsQuery, signal),
    enabled: enabled && scope === null,
  });

  // The calendar and the outlook ignore the date range: they have their own ranges up to today.
  const calendarQuery: UsageQuery = {
    from: calendarStart(today),
    to: today,
    tz: timeZone,
    client: scope,
  };
  const calendar = useQuery({
    queryKey: [...PANEL_KEY, "calendar", calendarQuery],
    queryFn: ({ signal }) => fetchUsageSeries(calendarQuery, "day", signal),
    enabled,
  });
  const monthQuery: UsageQuery = { ...calendarQuery, from: monthStart(today) };
  const month = useQuery({
    queryKey: [...PANEL_KEY, "month", monthQuery],
    queryFn: ({ signal }) => fetchUsageSeries(monthQuery, "day", signal),
    enabled,
  });

  if (unknownClient) return null;

  const rangeLabel =
    state.range.kind === "absolute"
      ? `${formatDay(state.range.from)} to ${formatDay(state.range.to)}`
      : rangeName(relativeRangeValue(state.range));

  return (
    <>
      {project === null ? (
        <h1>Usage</h1>
      ) : (
        <>
          <h1>
            {project.label} <span className="heading-client">{project.client ?? UNASSIGNED}</span>
          </h1>
          <p>
            <ScopedLink to={pathWithState("/usage", state)}>All Projects</ScopedLink>
          </p>
        </>
      )}
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
        {scope === null ? (
          <LimitTiles query={limits} now={now} />
        ) : (
          <p className="note">Limit windows are plan-wide. They show only in the scope All.</p>
        )}
      </div>
      <UsageOverTime query={series} metric={state.metric} grain={grain} />
      <DimensionPanel
        tabs={tabs}
        tab={state.tab}
        metric={state.metric}
        query={dimension}
        projectHref={(id) => pathWithState(`/usage/projects/${id}`, state)}
        onTab={(tab) => {
          update({ tab });
        }}
      />
      {scope === null ? (
        <LimitHistory query={limits} now={now} includesToday={resolved.to === today} />
      ) : null}
      <ActivityCalendarPanel query={calendar} metric={state.metric} today={today} />
      <CacheEfficiency query={totals} />
      <MonthOutlook query={month} today={today} />
      <p className="muted">Times in {timeZone}</p>
    </>
  );
}

export function UsagePage() {
  return <UsageView />;
}
