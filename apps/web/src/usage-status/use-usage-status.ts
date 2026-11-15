import type { RefreshStatusResponse } from "@foreman/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchUsageStatus } from "../api.ts";

/** The status is asked each 60 seconds while the tab is visible. */
export const STATUS_POLL_MS = 60_000;
/** The status is asked each 2 seconds while a refresh runs. */
export const STATUS_POLL_RUNNING_MS = 2_000;

export const USAGE_STATUS_KEY = ["usage", "status"] as const;

export interface UseUsageStatusOptions {
  /**
   * Called when the panels must load again: the "data as of" time changed, or a refresh that ran
   * has ended. It is not called for the first status.
   */
  onDataChanged?: () => void;
}

export interface UsageStatus {
  data: RefreshStatusResponse | undefined;
  isPending: boolean;
  isError: boolean;
}

/** Follows `/api/usage/status`. A hidden tab does not ask: the query pauses its interval. */
export function useUsageStatus(options: UseUsageStatusOptions = {}): UsageStatus {
  const query = useQuery({
    queryKey: USAGE_STATUS_KEY,
    queryFn: ({ signal }) => fetchUsageStatus(signal),
    refetchInterval: (q) =>
      q.state.data?.state === "running" ? STATUS_POLL_RUNNING_MS : STATUS_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const callback = useRef(options.onDataChanged);
  useEffect(() => {
    callback.current = options.onDataChanged;
  });

  const previous = useRef<RefreshStatusResponse | null>(null);
  const { data } = query;
  useEffect(() => {
    if (data === undefined) return;
    const before = previous.current;
    previous.current = data;
    if (before === null) return;
    const asOfChanged = before.dataAsOf !== data.dataAsOf;
    const refreshEnded = before.state === "running" && data.state !== "running";
    if (asOfChanged || refreshEnded) callback.current?.();
  }, [data]);

  return { data, isPending: query.isPending, isError: query.isError };
}
