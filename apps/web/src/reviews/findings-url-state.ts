import { FindingOutcome, FindingSeverity, FindingStatus } from "@foreman/shared";
import { useCallback, useEffect, useState } from "react";

/** The URL keys of the findings filters. They differ from the keys of the other Reviews values. */
export const FINDINGS_KEYS = [
  "findings_repo",
  "findings_pass",
  "findings_severity",
  "findings_status",
  "findings_outcome",
] as const;
export type FindingsKey = (typeof FINDINGS_KEYS)[number];

/** The values that are set, as API request values. */
export type FindingsFilters = Partial<
  Record<"repo" | "pass" | "severity" | "status" | "outcome", string>
>;

const REQUEST_KEY = {
  findings_repo: "repo",
  findings_pass: "pass",
  findings_severity: "severity",
  findings_status: "status",
  findings_outcome: "outcome",
} as const;

const VALID: Record<FindingsKey, (value: string) => boolean> = {
  findings_repo: (value) => /^[\w.-]+\/[\w.-]+$/.test(value) && value.length <= 200,
  findings_pass: (value) => value.length >= 1 && value.length <= 60,
  findings_severity: (value) => FindingSeverity.safeParse(value).success,
  findings_status: (value) => FindingStatus.safeParse(value).success,
  findings_outcome: (value) => value === "none" || FindingOutcome.safeParse(value).success,
};

/** The filters of a URL. A value that is not valid is left out, so the table shows no filter for it. */
export function parseFindingsFilters(search: string): FindingsFilters {
  const params = new URLSearchParams(search);
  const filters: FindingsFilters = {};
  for (const key of FINDINGS_KEYS) {
    const value = params.get(key);
    if (value !== null && VALID[key](value)) filters[REQUEST_KEY[key]] = value;
  }
  return filters;
}

/** The findings filters of the URL. A change writes a history entry and keeps the other values. */
export function useFindingsFilters() {
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

  const setFilter = useCallback((key: FindingsKey, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(window.location.search);
  }, []);

  return { filters: parseFindingsFilters(search), setFilter };
}
