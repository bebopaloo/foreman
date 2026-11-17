import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchDash } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { isStalled, STALLED_TITLE_PREFIX } from "./run-state.ts";

/** The dash asks again each 60 seconds, as the dash page does. The two share one query. */
const REFRESH_MS = 60_000;

/** The tab title without the prefix. A browser can trim the space at the end of the prefix. */
function plainTitle(): string {
  return document.title.startsWith(STALLED_TITLE_PREFIX.trimEnd())
    ? document.title.slice(STALLED_TITLE_PREFIX.trimEnd().length).trimStart()
    : document.title;
}

/** Puts "Stalled · " before the tab title while the newest run is stalled. */
export function useStalledTitle(): void {
  const { scope, clientsSettled, unknownClient } = useScope();
  const dash = useQuery({
    queryKey: ["dash", scope],
    queryFn: ({ signal }) => fetchDash(scope, signal),
    enabled: clientsSettled && !unknownClient,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const stalled = isStalled(dash.data);
  useEffect(() => {
    document.title = stalled ? `${STALLED_TITLE_PREFIX}${plainTitle()}` : plainTitle();
    return () => {
      document.title = plainTitle();
    };
  }, [stalled]);
}
