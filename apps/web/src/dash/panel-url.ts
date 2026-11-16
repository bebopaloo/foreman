import { WorkSet } from "@foreman/shared";
import { useCallback, useEffect, useState } from "react";

export const PANEL_KEY = "panel";

export type ParsedPanel = { kind: "none" } | { kind: "invalid" } | { kind: "panel"; set: WorkSet };

/** Validates the `panel` URL value with the shared schema. A value that is not valid is not dropped. */
export function parsePanel(search: string): ParsedPanel {
  const values = new URLSearchParams(search).getAll(PANEL_KEY);
  if (values.length === 0) return { kind: "none" };
  const result = WorkSet.safeParse(values.length === 1 ? values[0] : null);
  return result.success ? { kind: "panel", set: result.data } : { kind: "invalid" };
}

/**
 * The open panel of the URL. Each open and close writes a new history entry, and keeps the other
 * URL values. `openCount` grows with each open from the page, so the panel can move the focus.
 */
export function useUrlPanel() {
  const [search, setSearch] = useState(() => window.location.search);
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    const onPopState = () => {
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const write = useCallback((set: WorkSet | null) => {
    const url = new URL(window.location.href);
    if (set === null) url.searchParams.delete(PANEL_KEY);
    else url.searchParams.set(PANEL_KEY, set);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(window.location.search);
  }, []);

  const open = useCallback(
    (set: WorkSet) => {
      write(set);
      setOpenCount((count) => count + 1);
    },
    [write],
  );
  const close = useCallback(() => {
    write(null);
  }, [write]);

  return { parsed: parsePanel(search), open, close, openCount };
}
