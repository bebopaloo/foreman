import { useQuery } from "@tanstack/react-query";
import { fetchDash } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { LastRun } from "./LastRun.tsx";
import { summariseNow } from "./run-state.ts";

/** The dash asks again each 60 seconds while the tab is visible. The query pauses in a hidden tab. */
export const DASH_REFRESH_MS = 60_000;

export function DashPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const dash = useQuery({
    queryKey: ["dash", scope],
    queryFn: ({ signal }) => fetchDash(scope, signal),
    // Nothing loads until the scope is known to be a real client.
    enabled: clientsSettled && !unknownClient,
    refetchInterval: DASH_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  if (unknownClient) return null;

  const now = dash.data ? summariseNow(dash.data) : null;
  const reviewUnreadable = dash.data?.sources.controls === "unreadable";

  return (
    <>
      <h1>Foreman dash</h1>
      {dash.isError ? (
        <p role="alert" className="note note-warn">
          The dash data cannot be read. The API may be stopped: start it with pnpm dev, then reload
          this page.
        </p>
      ) : null}
      {dash.isPending ? <p role="status">Reading the dash.</p> : null}
      <section className="card" aria-labelledby="dash-now">
        <h2 id="dash-now">Now</h2>
        {now === null ? (
          <p className="muted">No data yet.</p>
        ) : (
          <p>
            <strong>{now.headline}</strong>
            {now.detail === null ? null : <span className="muted">: {now.detail}</span>}
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="dash-waits">
        <h2 id="dash-waits">Waits for you</h2>
        <p className="muted">Not shown yet.</p>
      </section>
      <section className="card" aria-labelledby="dash-last-run">
        <h2 id="dash-last-run">Last run</h2>
        <LastRun dash={dash.data} />
      </section>
      <section className="card" aria-labelledby="dash-review">
        <h2 id="dash-review">Review health</h2>
        <p className="muted">
          {reviewUnreadable ? "cannot read the factory folder" : "Not shown yet."}
        </p>
      </section>
      <section className="card" aria-labelledby="dash-repos">
        <h2 id="dash-repos">Repos</h2>
        <p className="muted">Not shown yet.</p>
      </section>
    </>
  );
}
