import type { RepoEntry } from "./repo-list.ts";

export interface ClientCount {
  name: string;
  repoCount: number;
}

export interface ClientList {
  clients: ClientCount[];
  unassignedCount: number;
}

/** The clients are the distinct `client` values. A repo with no `client` is unassigned. */
export function listClients(repos: readonly RepoEntry[]): ClientList {
  const counts = new Map<string, number>();
  let unassignedCount = 0;
  for (const repo of repos) {
    if (repo.client === null) {
      unassignedCount += 1;
    } else {
      counts.set(repo.client, (counts.get(repo.client) ?? 0) + 1);
    }
  }
  const clients = [...counts]
    .map(([name, repoCount]) => ({ name, repoCount }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { clients, unassignedCount };
}

/**
 * The Project keys of a client: the paths of its repo list entries. The result is null when the
 * client is not in the list, so that the caller can refuse an unknown client.
 */
export function clientProjectKeys(repos: readonly RepoEntry[], client: string): string[] | null {
  const own = repos.filter((repo) => repo.client === client);
  return own.length === 0 ? null : [...new Set(own.map((repo) => repo.path))];
}

/** The client of each Project key, from the paths of the repo list entries that have a client. */
export function clientsByProjectKey(repos: readonly RepoEntry[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const repo of repos) {
    if (repo.client !== null && !result.has(repo.path)) result.set(repo.path, repo.client);
  }
  return result;
}
