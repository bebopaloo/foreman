import type { RepoEntry } from "./repo-list.ts";
import { resolveToken, type TokenStore } from "./tokens.ts";

export interface ScopedRepo {
  id: string;
  host: string;
}

export type WorkScope =
  | { ok: true; repos: ScopedRepo[]; inScope: readonly RepoEntry[] }
  | { ok: false; error: "Unknown client" | "Unknown repo" };

/**
 * The repos that a list route may read: the repos of the client (or all repos), minus the repos
 * of an owner with no token and the repos with no forge name. `inScope` holds all entries of the
 * client and repo values, the skipped ones too. A repo ID outside the client is refused.
 */
export function resolveWorkScope(
  entries: readonly RepoEntry[],
  tokens: TokenStore,
  client: string | undefined,
  repo: string | undefined,
): WorkScope {
  const inClient =
    client === undefined ? entries : entries.filter((entry) => entry.client === client);
  if (client !== undefined && inClient.length === 0) return { ok: false, error: "Unknown client" };
  if (repo !== undefined && !inClient.some((entry) => entry.id === repo)) {
    return { ok: false, error: "Unknown repo" };
  }
  const inScope = repo === undefined ? inClient : inClient.filter((entry) => entry.id === repo);
  const repos: ScopedRepo[] = [];
  for (const entry of inClient) {
    if (entry.owner === null || entry.name === null) continue;
    if (repo !== undefined && entry.id !== repo) continue;
    if (!resolveToken(tokens, entry.host, entry.owner, { tokenPrefix: "" }).ok) continue;
    repos.push({ id: entry.id, host: entry.host });
  }
  return { ok: true, repos, inScope };
}
