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
