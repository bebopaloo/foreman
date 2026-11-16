import { ISSUE_STATES, SET_LABELS, type WorkItem, type WorkItemsResponse } from "@foreman/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkItems, fetchWorkRepos } from "../api.ts";
import { usePagedList } from "../list/index.ts";
import { ScopedLink, useScope } from "../scope/index.ts";
import { WorkFilters } from "./WorkFilters.tsx";
import { WorkTable } from "./WorkTable.tsx";
import { filterQuery, setQuery, useUrlFilters } from "./url-state.ts";

/** The work view asks again each 60 seconds while the tab is visible. */
export const WORK_REFRESH_MS = 60_000;

export function WorkPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  const { parsed, setFilter } = useUrlFilters();
  const repos = useQuery({
    queryKey: ["work", "repos"],
    queryFn: ({ signal }) => fetchWorkRepos(signal),
  });

  const scopedRepos = (repos.data?.repos ?? []).filter(
    (repo) => scope === null || repo.client === scope,
  );
  const repoUnknown =
    parsed.valid &&
    parsed.filters.repo !== undefined &&
    repos.data !== undefined &&
    !scopedRepos.some((repo) => repo.id === parsed.filters.repo);
  const valid = parsed.valid && !repoUnknown;
  const dashSet = parsed.valid ? parsed.dashSet : null;
  const request = parsed.valid
    ? {
        ...(dashSet === null ? filterQuery(parsed.filters) : setQuery(dashSet)),
        ...(scope === null ? {} : { client: scope }),
      }
    : {};

  const list = usePagedList<WorkItem, WorkItemsResponse>({
    queryKey: ["work", "items", request],
    fetchPage: (cursor, signal) => fetchWorkItems(request, cursor, signal),
    // Nothing loads until the scope is a real client and every filter value is valid.
    enabled: clientsSettled && !unknownClient && valid && repos.isSuccess,
    refetchInterval: WORK_REFRESH_MS,
  });

  if (unknownClient) return null;

  const first = list.firstPage;
  const names = new Map((repos.data?.repos ?? []).map((repo) => [repo.id, repo.fullName]));

  return (
    <>
      <h1>Issues and pull requests</h1>
      <p className="muted">
        Source: tracker and forge (Work cache) and Control events. Titles only, no body text.
      </p>
      {!valid && (parsed.valid ? repos.isSuccess : true) ? (
        <p role="alert" className="note note-warn">
          This link has a filter value that is not valid.{" "}
          <ScopedLink to="/work">Show all work</ScopedLink>
        </p>
      ) : null}
      {valid && dashSet !== null ? (
        <p className="note">
          <span>Dash list: {SET_LABELS[dashSet.set]}</span>{" "}
          <ScopedLink to="/work">Show all work</ScopedLink>
        </p>
      ) : null}
      {valid && (list.isError || repos.isError) ? (
        <p role="alert" className="note note-warn">
          The work items cannot be read. The API may be stopped: start it with pnpm dev, then reload
          this page.
        </p>
      ) : null}
      {valid && list.isPending && !list.isError ? (
        <p role="status">Reading the work items.</p>
      ) : null}
      {valid && first?.state === "not_connected" ? (
        <p>
          Not connected. Add the Foreman token to the Keychain, then run <code>pnpm local:up</code>.
        </p>
      ) : null}
      {valid && first?.state === "ok" ? (
        <div className="work-view">
          {first.complete > 0 ? (
            <p className="note note-warn">
              Data is not complete: {first.complete.toString()}{" "}
              {first.complete === 1 ? "repo" : "repos"} not connected. See{" "}
              <ScopedLink to="/#dash-repos">Repos</ScopedLink>.
            </p>
          ) : null}
          {first.noControlEvents.map((id) =>
            names.has(id) ? (
              <p key={id} className="note">
                No Control events in 30 days for {names.get(id)}. Round and the event Machine gate
                show —.
              </p>
            ) : null,
          )}
          <WorkFilters
            counts={first.counts}
            filters={parsed.filters}
            repos={scopedRepos}
            setFilter={setFilter}
            states={ISSUE_STATES}
            disabled={dashSet !== null}
          />
          {list.rows.length === 0 ? (
            <p className="muted">
              {dashSet === null
                ? "No issues or pull requests match these filters."
                : "This dash list has no items."}
            </p>
          ) : (
            <WorkTable list={list} />
          )}
        </div>
      ) : null}
    </>
  );
}
