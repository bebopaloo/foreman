import { WorkItemsFilters, WorkItemsQuery, type WorkSet } from "@foreman/shared";
import { useCallback, useEffect, useState } from "react";

/** The URL values of the filters and the sort, next to `client`. */
export const FILTER_KEYS = ["issue_state", "type", "priority", "repo", "sort"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

const FilterQuery = WorkItemsFilters;

export type WorkFilters = ReturnType<typeof FilterQuery.parse>;

/** The dash list of the URL: the `set` value and, for builds and merged, the `run` value. */
export interface DashSet {
  set: WorkSet;
  run?: string;
}

export type ParsedFilters =
  { valid: true; filters: WorkFilters; dashSet: DashSet | null } | { valid: false };

/** Validates the filter values of a URL with the shared schema. A value that is not valid is not dropped. */
export function parseFilters(search: string): ParsedFilters {
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  const result = FilterQuery.safeParse(raw);
  if (!result.success) return { valid: false };
  const set = params.get("set");
  const run = params.get("run");
  if (set === null && run === null) return { valid: true, filters: result.data, dashSet: null };
  // The API query schema decides which combinations of set, run and filters are allowed.
  const query = WorkItemsQuery.safeParse({
    ...raw,
    ...(set === null ? {} : { set }),
    ...(run === null ? {} : { run }),
  });
  if (!query.success || query.data.set === undefined) return { valid: false };
  const dashSet: DashSet = { set: query.data.set };
  if (query.data.run !== undefined) dashSet.run = query.data.run;
  return { valid: true, filters: result.data, dashSet };
}

/** The request values of a dash list. The order is the order of the set, so there is no sort. */
export function setQuery(dashSet: DashSet): Record<string, string> {
  return dashSet.run === undefined ? { set: dashSet.set } : { set: dashSet.set, run: dashSet.run };
}

/** The values of the filters as request values. A filter that is not set is left out. */
export function filterQuery(filters: WorkFilters): Record<string, string> {
  const query: Record<string, string> = { sort: filters.sort };
  for (const key of ["issue_state", "type", "priority", "repo"] as const) {
    const value = filters[key];
    if (value !== undefined) query[key] = value;
  }
  return query;
}

/** The filters of the URL. A change of a filter writes a new history entry and keeps the other values. */
export function useUrlFilters() {
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const onPopState = () => {
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const setFilter = useCallback((key: FilterKey, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(window.location.search);
  }, []);

  return { parsed: parseFilters(search), setFilter };
}
