import { useCallback, useEffect, useState } from "react";

export interface SessionsUrlValues {
  /** The `day` value as written, or null with none. */
  day: string | null;
  /** The `session` value as written, or null with none. */
  session: string | null;
}

export function readSessionsUrl(search: string): SessionsUrlValues {
  const params = new URLSearchParams(search);
  const value = (name: string): string | null => {
    const found = params.get(name);
    return found === null || found === "" ? null : found;
  };
  return { day: value("day"), session: value("session") };
}

/** Changes to the URL values. A null value removes the parameter. */
export type SessionsUrlChange = Partial<SessionsUrlValues>;

/**
 * The `day` and `session` values of the URL. A change adds a history entry, so Back returns to the
 * earlier day or session, and it keeps every other value, such as the Client scope.
 */
export function useSessionsUrl(): SessionsUrlValues & {
  navigate: (change: SessionsUrlChange) => void;
} {
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

  const navigate = useCallback((change: SessionsUrlChange) => {
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(change)) {
      if (value === null) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    }
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(url.search);
  }, []);

  return { ...readSessionsUrl(search), navigate };
}
