import type { DashResponse } from "@foreman/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchDash } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { LastRun } from "./LastRun.tsx";
import { plural } from "./last-run.ts";
import { PipelineStrip } from "./PipelineStrip.tsx";
import { ReviewHealth } from "./ReviewHealth.tsx";
import { summariseNow } from "./run-state.ts";
import { Tiles } from "./Tiles.tsx";

/** The dash asks again each 60 seconds while the tab is visible. The query pauses in a hidden tab. */
export const DASH_REFRESH_MS = 60_000;

function buildsText({ run, running }: DashResponse): string {
  if (running === null) return "";
  if (run.state !== "in_progress") {
    return `${plural(running.count, "build waits", "builds wait")} for the next run`;
  }
  return running.slotLimit === null
    ? plural(running.count, "build running", "builds running")
    : `${running.count.toString()} of ${running.slotLimit.toString()} build slots in use`;
}

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
      {dash.data === undefined ? null : <Tiles dash={dash.data} />}
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
        {dash.data === undefined || dash.data.running === null ? null : (
          <p>{buildsText(dash.data)}</p>
        )}
      </section>
      {dash.data === undefined ? null : <PipelineStrip dash={dash.data} />}
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
        {dash.data === undefined ? (
          <p className="muted">No data yet.</p>
        ) : reviewUnreadable ? (
          <p className="muted">cannot read the factory folder</p>
        ) : (
          <ReviewHealth health={dash.data.reviewHealth} />
        )}
      </section>
      <section className="card" aria-labelledby="dash-repos">
        <h2 id="dash-repos">Repos</h2>
        <p className="muted">Not shown yet.</p>
      </section>
    </>
  );
}
