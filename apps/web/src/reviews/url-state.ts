import { ReviewsMode } from "@foreman/shared";
import { useCallback, useEffect, useState } from "react";

export interface ReviewsUrlState {
  mode: ReviewsMode;
  /** True when the URL has a `mode` value that is not valid. The page then shows the default. */
  invalid: boolean;
}

export function parseMode(search: string): ReviewsUrlState {
  const raw = new URLSearchParams(search).get("mode");
  if (raw === null) return { mode: "round1", invalid: false };
  const parsed = ReviewsMode.safeParse(raw);
  return parsed.success ? { mode: parsed.data, invalid: false } : { mode: "round1", invalid: true };
}

/** The `mode` of the URL. A change writes a history entry, and the default leaves `mode` out. */
export function useReviewsMode() {
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

  const setMode = useCallback((mode: ReviewsMode) => {
    const url = new URL(window.location.href);
    if (mode === "round1") url.searchParams.delete("mode");
    else url.searchParams.set("mode", mode);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSearch(window.location.search);
  }, []);

  return { ...parseMode(search), setMode };
}
