import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const REPO = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/;
const CLIENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_HOST = "github.com";

const RepoListEntry = z
  .object({
    path: z.string().min(1),
    forge: z.string().min(1).optional(),
    tracker: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    repo: z.string().regex(REPO).optional(),
    host: z.string().regex(HOST).optional(),
    client: z.string().regex(CLIENT).optional(),
  })
  .strict();

const RepoListFile = z.object({ repos: z.array(z.unknown()) });

export interface RepoEntry {
  /** The index of the entry in the file, from 0. */
  position: number;
  id: string;
  host: string;
  /** Null for an entry with no `repo` field: no adapter runs for it. */
  owner: string | null;
  name: string | null;
  client: string | null;
  path: string;
  forge: string | null;
  tracker: string | null;
  enabled: boolean;
}

/** A problem names the entry and the field. It never holds a value. */
export interface RepoListProblem {
  position: number;
  field: string;
}

export type RepoListResult =
  | { status: "missing" }
  | { status: "unreadable" }
  | {
      status: "ok";
      /** The entries that Foreman uses: valid, and with no duplicate or a duplicate of one client. */
      repos: RepoEntry[];
      problems: RepoListProblem[];
      /** The IDs of every repo that any entry names, also an entry that Foreman skips. */
      namedIds: Set<string>;
      /** True when a skipped entry names no repo that Foreman can read. */
      identityUnknown: boolean;
    };

export function repoId(host: string, owner: string, name: string): string {
  return createHash("sha256")
    .update(`${host}/${owner}/${name}`.toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

export function repoListPath(claudeDir: string): string {
  return path.join(claudeDir, "factory", "repos.json");
}

function failedField(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "entry";
  if (issue.code === "unrecognized_keys") return issue.keys[0] ?? "entry";
  const first = issue.path[0];
  return typeof first === "string" ? first : "entry";
}

async function readJson(file: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(file, "utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The identity of a raw entry, read as leniently as the repo and host fields allow. */
function identityOf(raw: unknown): { host: string; owner: string; name: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const host = record.host ?? DEFAULT_HOST;
  if (typeof host !== "string" || !HOST.test(host)) return null;
  if (typeof record.repo !== "string" || !REPO.test(record.repo)) return null;
  const [owner, name] = record.repo.split("/") as [string, string];
  return { host, owner, name };
}

export async function readRepoList(claudeDir: string): Promise<RepoListResult> {
  const file = repoListPath(claudeDir);
  try {
    await readFile(file);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "unreadable" };
  }
  const json = await readJson(file);
  if (!json.ok) return { status: "unreadable" };
  const list = RepoListFile.safeParse(json.value);
  if (!list.success) return { status: "unreadable" };

  const problems: RepoListProblem[] = [];
  const namedIds = new Set<string>();
  let identityUnknown = false;
  const valid: RepoEntry[] = [];

  list.data.repos.forEach((raw, position) => {
    const identity = identityOf(raw);
    if (identity !== null) {
      namedIds.add(repoId(identity.host, identity.owner, identity.name));
    }
    const parsed = RepoListEntry.safeParse(raw);
    if (!parsed.success) {
      problems.push({ position, field: failedField(parsed.error) });
      if (identity === null) identityUnknown = true;
      return;
    }
    if (identity === null) {
      if (parsed.data.repo !== undefined) return;
      const host = (parsed.data.host ?? DEFAULT_HOST).toLowerCase();
      valid.push({
        position,
        id: repoId("no-repo", host, parsed.data.path),
        host,
        owner: null,
        name: null,
        client: parsed.data.client ?? null,
        path: parsed.data.path,
        forge: parsed.data.forge ?? null,
        tracker: parsed.data.tracker ?? null,
        enabled: parsed.data.enabled ?? true,
      });
      return;
    }
    valid.push({
      position,
      id: repoId(identity.host, identity.owner, identity.name),
      host: identity.host.toLowerCase(),
      owner: identity.owner,
      name: identity.name,
      client: parsed.data.client ?? null,
      path: parsed.data.path,
      forge: parsed.data.forge ?? null,
      tracker: parsed.data.tracker ?? null,
      enabled: parsed.data.enabled ?? true,
    });
  });

  const groups = new Map<string, RepoEntry[]>();
  for (const entry of valid) {
    groups.set(entry.id, [...(groups.get(entry.id) ?? []), entry]);
  }
  const repos: RepoEntry[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    if (group.every((entry) => entry.client === first.client)) {
      repos.push(first);
    } else {
      for (const entry of group) problems.push({ position: entry.position, field: "client" });
    }
  }
  repos.sort((a, b) => a.position - b.position);
  problems.sort((a, b) => a.position - b.position);

  return { status: "ok", repos, problems, namedIds, identityUnknown };
}
