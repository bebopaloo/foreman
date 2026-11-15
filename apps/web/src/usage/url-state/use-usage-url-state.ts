import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseUsageUrl,
  USAGE_TABS,
  writeUsageUrl,
  type ParsedUsageUrl,
  type UsageTab,
  type UsageUrlState,
} from "./url-state.ts";

export interface UsageUrlControl {
  state: UsageUrlState;
  /** True while the page shows the defaults for a value of the link that was not valid. */
  invalid: boolean;
  /** Changes some values. It adds one history entry, so the Back button undoes it. */
  update: (patch: Partial<UsageUrlState>) => void;
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Writes the canonical query string with no new history entry. */
function fixUrl(state: UsageUrlState): void {
  const wanted = `${window.location.pathname}${writeUsageUrl(window.location.search, state)}${window.location.hash}`;
  if (wanted !== currentUrl()) window.history.replaceState(window.history.state, "", wanted);
}

/**
 * The range, grain, metric and tab of the page, kept in the URL. It reads `location.search` on load
 * and on `popstate`, fixes the URL with `replaceState`, and writes each change with `pushState`.
 */
export function useUsageUrlState(tabs: readonly UsageTab[] = USAGE_TABS): UsageUrlControl {
  const [parsed, setParsed] = useState<ParsedUsageUrl>(() =>
    parseUsageUrl(window.location.search, tabs),
  );
  const latest = useRef(parsed.state);
  useEffect(() => {
    latest.current = parsed.state;
  }, [parsed.state]);
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    fixUrl(latest.current);
    const onPopState = () => {
      const next = parseUsageUrl(window.location.search, tabsRef.current);
      fixUrl(next.state);
      setParsed(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const update = useCallback((patch: Partial<UsageUrlState>) => {
    const next = { ...latest.current, ...patch };
    const wanted = `${window.location.pathname}${writeUsageUrl(window.location.search, next)}${window.location.hash}`;
    if (wanted !== currentUrl()) window.history.pushState(window.history.state, "", wanted);
    latest.current = next;
    setParsed({ state: next, invalid: false });
  }, []);

  return { state: parsed.state, invalid: parsed.invalid, update };
}
