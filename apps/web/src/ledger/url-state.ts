import { LedgerQuery } from "@foreman/shared";
import { useCallback, useEffect, useState } from "react";

export interface LedgerUrlState {
  /** The range of the URL, or null for this month: no values, or values that are not valid. */
  range: { from: string; to: string } | null;
  /** True when the URL has range values that are not valid. The page then shows this month. */
  invalid: boolean;
}

export function parseLedgerUrl(search: string): LedgerUrlState {
  const params = new URLSearchParams(search);
  const from = params.get("from") || null;
  const to = params.get("to") || null;
  if (from === null && to === null) return { range: null, invalid: false };
  const parsed = LedgerQuery.safeParse({
    ...(from === null ? {} : { from }),
    ...(to === null ? {} : { to }),
  });
  if (!parsed.success || parsed.data.from === undefined || parsed.data.to === undefined) {
    return { range: null, invalid: true };
  }
  return { range: { from: parsed.data.from, to: parsed.data.to }, invalid: false };
}

/**
 * The `from` and `to` values of the URL. A change adds a history entry, so Back returns to the
 * earlier range, and it keeps every other value, such as the Client scope. A null range removes
 * both values: this month.
 */
export function useLedgerUrl() {
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

  const setRange = useCallback((range: { from: string; to: string } | null) => {
    const url = new URL(window.location.href);
    if (range === null) {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    } else {
      url.searchParams.set("from", range.from);
      url.searchParams.set("to", range.to);
    }
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(url.search);
  }, []);

  return { ...parseLedgerUrl(search), setRange };
}
