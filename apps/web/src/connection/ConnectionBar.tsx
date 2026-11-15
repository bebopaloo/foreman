import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWorkRepos, fetchWorkStatus, refreshUsage, refreshWork } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { formatTime, oldestDataAsOf, summariseConnection } from "./connection.ts";

const POLL_MS = 2000;

export function ConnectionBar() {
  const { scope, unknownClient, unassignedCount } = useScope();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["work", "status"],
    queryFn: ({ signal }) => fetchWorkStatus(signal),
    refetchInterval: (query) => (query.state.data?.state === "running" ? POLL_MS : false),
  });
  const repos = useQuery({
    queryKey: ["work", "repos"],
    queryFn: ({ signal }) => fetchWorkRepos(signal),
  });
  const refresh = useMutation({
    mutationFn: () => Promise.all([refreshWork(), refreshUsage()]),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work"] }),
        queryClient.invalidateQueries({ queryKey: ["usage"] }),
      ]),
  });

  const running = refresh.isPending || status.data?.state === "running";
  const summary = status.data ? summariseConnection(status.data) : null;
  const asOf = repos.data && !unknownClient ? oldestDataAsOf(repos.data.repos, scope) : null;

  return (
    <section aria-label="Connection" className="connection">
      <div className="connection-state">
        {summary ? (
          <>
            <span className={`dot dot-${summary.tone}`} aria-hidden="true" />
            <strong>{summary.title}</strong>
            {summary.detail === "" ? null : <span className="muted">{summary.detail}</span>}
          </>
        ) : (
          <span className="muted">
            {status.isError ? "The connection state cannot be read." : "Reading the connection."}
          </span>
        )}
      </div>
      <div className="connection-actions">
        <span>
          Data as of{" "}
          {asOf === null ? (
            <span className="mono">not yet</span>
          ) : (
            <time className="mono" dateTime={asOf}>
              {formatTime(asOf)}
            </time>
          )}
        </span>
        <button
          type="button"
          disabled={running}
          onClick={() => {
            refresh.mutate();
          }}
        >
          {running ? "Refreshing" : "Refresh"}
        </button>
      </div>
      {status.data?.state === "failed" ? (
        <p role="status" className="note note-warn">
          The last fetch failed{status.data.reason === null ? "" : `: ${status.data.reason}`}. The
          views show the cached data.
        </p>
      ) : null}
      {refresh.isError ? (
        <p role="status" className="note note-warn">
          The refresh request failed. Try again.
        </p>
      ) : null}
      {unassignedCount > 0 && scope === null ? (
        <p role="status" className="note">
          {unassignedCount.toString()} {unassignedCount === 1 ? "repo has" : "repos have"} no
          client. {unassignedCount === 1 ? "It shows" : "They show"} only in All.
        </p>
      ) : null}
    </section>
  );
}
