import type { ReviewsPullRequest, ReviewsPullRequestsResponse } from "@foreman/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchReviews, fetchReviewsPullRequests } from "../api.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { FindingsSection } from "./FindingsSection.tsx";
import { EventsOff } from "./EventsOff.tsx";
import { RiskTierResults, isEmptyTierResults } from "./RiskTierResults.tsx";
import { ReviewTime } from "./ReviewTime.tsx";
import { RoundsToSettle } from "./RoundsToSettle.tsx";
import { SecurityFindings } from "./SecurityFindings.tsx";
import { Tiles } from "./Tiles.tsx";
import { useReviewsMode } from "./url-state.ts";
import "./reviews.css";

/** The Reviews view asks again each 60 seconds while the tab is visible. The queries pause in a hidden tab. */
export const REVIEWS_REFRESH_MS = 60_000;

export function ReviewsPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const { mode, invalid, setMode } = useReviewsMode();
  const queryClient = useQueryClient();
  // Nothing loads until the scope is known to be a real client.
  const enabled = clientsSettled && !unknownClient;

  const reviews = useQuery({
    queryKey: ["reviews", "document", scope, mode],
    queryFn: ({ signal }) => fetchReviews(scope, mode, signal),
    enabled,
    refetchInterval: REVIEWS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const list = usePagedList<ReviewsPullRequest, ReviewsPullRequestsResponse>({
    queryKey: ["reviews", "pull-requests", scope],
    fetchPage: (cursor, signal) => fetchReviewsPullRequests(scope, cursor, signal),
    enabled,
    refetchInterval: REVIEWS_REFRESH_MS,
  });
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["reviews"] });
  }, [queryClient]);

  if (unknownClient) return null;

  const { data } = reviews;
  const empty =
    data !== undefined && isEmptyTierResults(data.tierResults) && data.rounds.length === 0;

  return (
    <>
      <h1>Reviews</h1>
      <p className="muted">
        Source: gate, escalated and merged Control events, the night log and the Usage index. Last
        30 days. Counts, tiers and times only, no finding text.
      </p>
      {invalid ? (
        <p role="status" className="note note-warn">
          The link has a mode value that is not valid. The page shows Found in round 1.
        </p>
      ) : null}
      {reviews.isError ? (
        <p role="alert" className="note note-warn">
          The review data cannot be read. The API may be stopped: start it with pnpm dev, then
          reload this page.
        </p>
      ) : null}
      {reviews.isPending ? <p role="status">Reading the reviews.</p> : null}
      {data === undefined ? null : (
        <div className="reviews-view">
          <Tiles data={data} />
          <EventsOff entries={data.eventsOff} factoryLoginSet={data.factoryLoginSet} />
          <div className="reviews-grid">
            <RiskTierResults results={data.tierResults} />
            <RoundsToSettle rounds={data.rounds} empty={empty} />
          </div>
          <SecurityFindings
            findings={data.findings}
            notes={{ state: data.state, complete: data.complete }}
            empty={empty}
            mode={mode}
            onMode={setMode}
          />
          <FindingsSection refreshMs={REVIEWS_REFRESH_MS} />
          <ReviewTime data={data} list={list} onDataChanged={reload} />
        </div>
      )}
    </>
  );
}
