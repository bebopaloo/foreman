import type { DashResponse } from "@foreman/shared";
import { formatTime } from "../connection/connection.ts";

const time = (iso: string | null): string => (iso === null ? "none" : formatTime(iso));

/** The repos in scope with their connection states. Names, clients and states are text nodes. */
export function Repos({ dash }: { dash: DashResponse | undefined }) {
  if (dash === undefined) return <p className="muted">No data yet.</p>;
  if (dash.repos.length === 0) return <p className="muted">No repo in scope.</p>;
  return (
    <div className="table-scroll" role="region" aria-label="Repos table" tabIndex={0}>
      <table className="work-table repos-table">
        <caption className="sr-only">Repos in scope</caption>
        <thead>
          <tr>
            <th scope="col">Repo</th>
            <th scope="col">Client</th>
            <th scope="col">Connection</th>
            <th scope="col">Data as of</th>
            <th scope="col">Last night log line</th>
            <th scope="col">Last Control event</th>
          </tr>
        </thead>
        <tbody>
          {dash.repos.map((repo) => (
            <tr key={repo.repoId}>
              <td className="mono">{repo.repo}</td>
              <td>{repo.client ?? "no client"}</td>
              <td>{repo.state}</td>
              <td>{time(repo.dataAsOf)}</td>
              <td>{time(repo.lastLogAt)}</td>
              <td>{time(repo.lastControlAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
