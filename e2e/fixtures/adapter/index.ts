import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SYNTHETIC_HOST } from "./host.ts";

export { SYNTHETIC_HOST };

const SCRIPT = readFileSync(path.join(import.meta.dirname, "e2e_adapter.py"), "utf8");

export type AdapterRole = "forge" | "tracker";

/** The plugin names for the `forge` and `tracker` fields of a repo list entry. */
export const ADAPTER_PLUGINS = { forge: "synthetic-forge", tracker: "synthetic-tracker" } as const;

/** The prefix that the synthetic plugins declare. The tokens of the tokens file start with it. */
export const TOKEN_PREFIX = "synthetic-";

/** The install folder that `installed_plugins.json` names. Foreman maps it to the mounted Claude folder. */
const pluginFolder = (role: AdapterRole): string =>
  `plugins/cache/synthetic/${ADAPTER_PLUGINS[role]}/1.0.0`;

export interface AdapterIssue {
  number: number;
  title: string;
  issueState?: string;
  state?: "open" | "closed";
  priority?: string;
  labels?: string[];
  relations?: { parent?: number; children?: number[]; blockedBy?: number[] };
}

export interface AdapterPullRequest {
  number: number;
  title: string;
  head?: string;
  base?: string;
  state?: "open" | "closed" | "merged";
  /** The logins of the reviews of the pull request. */
  reviewers?: string[];
}

/** What the adapter answers for one repo (`owner/name`). */
export interface AdapterRepo {
  issues?: AdapterIssue[];
  pullRequests?: AdapterPullRequest[];
  /** An error message for each command (`issue relations 12`): the adapter fails that command. */
  fail?: Record<string, string>;
}

/** The fixture data of one set: what the synthetic adapter answers, by `owner/name`. */
export type AdapterData = Record<string, AdapterRepo>;

type Answer = { ok: unknown } | { error: string };

function repoScenario(repo: string, data: AdapterRepo): Record<string, Answer> {
  const url = (kind: string, number: number) =>
    `https://${SYNTHETIC_HOST}/${repo}/${kind}/${String(number)}`;
  const issues = (data.issues ?? []).map((issue) => ({
    number: issue.number,
    url: url("issues", issue.number),
    title: issue.title,
    body: "",
    state: issue.state ?? "open",
    labels: issue.labels ?? [],
    author: "synthetic-author",
    issue_state: issue.issueState ?? "READY",
    priority: issue.priority ?? "medium",
  }));
  const pulls = (data.pullRequests ?? []).map((pull) => ({
    number: pull.number,
    url: url("pull", pull.number),
    title: pull.title,
    state: pull.state ?? "open",
    draft: false,
    head: pull.head ?? `${String(pull.number)}-change`,
    base: pull.base ?? "main",
    author: "synthetic-author",
    checks: "success",
    labels: [],
  }));
  const scenario: Record<string, Answer> = {
    "issue list --state all": { ok: issues },
    "issue list --state open": { ok: issues.filter((issue) => issue.state === "open") },
    "release list --state all": { ok: [] },
    "pr list --state all": { ok: pulls },
    "pr list --state open": { ok: pulls.filter((pull) => pull.state === "open") },
  };
  for (const issue of data.issues ?? []) {
    scenario[`issue relations ${String(issue.number)}`] = {
      ok: {
        number: issue.number,
        parent: issue.relations?.parent ?? null,
        children: issue.relations?.children ?? [],
        blocked_by: issue.relations?.blockedBy ?? [],
      },
    };
  }
  for (const pull of data.pullRequests ?? []) {
    scenario[`pr reviews ${String(pull.number)}`] = {
      ok: (pull.reviewers ?? []).map((author) => ({
        author,
        state: "APPROVED",
        commit: "abc1234",
        body: "",
        time: "2026-01-02T03:04:05Z",
      })),
    };
  }
  for (const [command, error] of Object.entries(data.fail ?? {})) {
    scenario[command] = { error };
  }
  return Object.fromEntries(
    Object.entries(scenario).map(([key, value]) => [`${repo} ${key}`, value]),
  );
}

/**
 * The files of the synthetic adapter plugins for a Claude folder: `installed_plugins.json`, and for each
 * role a `plugin.json`, the adapter script and the scenario of the set.
 */
export function adapterFiles(data: AdapterData): Record<string, string> {
  const scenario = Object.assign(
    {},
    ...Object.entries(data).map(([repo, repoData]) => repoScenario(repo, repoData)),
  ) as Record<string, Answer>;
  const files: Record<string, string> = {};
  const plugins: Record<string, unknown[]> = {};
  for (const role of ["forge", "tracker"] as const) {
    const folder = pluginFolder(role);
    files[`${folder}/.claude-plugin/plugin.json`] = JSON.stringify({
      name: ADAPTER_PLUGINS[role],
      factory_adapter: {
        role,
        command: "e2e_adapter.py",
        token_env: "SYNTHETIC_TOKEN",
        token_prefix: TOKEN_PREFIX,
      },
    });
    files[`${folder}/e2e_adapter.py`] = SCRIPT;
    files[`${folder}/scenario.json`] = JSON.stringify(scenario);
    plugins[`${ADAPTER_PLUGINS[role]}@synthetic`] = [
      { scope: "user", installPath: `/synthetic/claude/${folder}`, version: "1.0.0" },
    ];
  }
  files["plugins/installed_plugins.json"] = JSON.stringify({ version: 2, plugins });
  return files;
}

export interface AdapterCall {
  command: string;
  host: string;
  repo: string;
  /** The real path of the script that ran. */
  script: string;
}

/** The calls that the synthetic adapter of a role got since its Claude folder was written. */
export async function adapterCalls(claudeDir: string, role: AdapterRole): Promise<AdapterCall[]> {
  const text = await readFile(
    path.join(claudeDir, pluginFolder(role), "calls.jsonl"),
    "utf8",
  ).catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as AdapterCall);
}
