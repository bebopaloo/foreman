import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "fixtures", "adapter", "scenario_adapter.py");

export const TOKEN = "github_pat_synthetic_value";

export type Scenario = Record<string, { ok: unknown } | { error: string }>;
export type Role = "tracker" | "forge";

const PLUGIN: Record<Role, string> = { tracker: "synth-tracker", forge: "synth-forge" };

/** The plugin names for the `forge` and `tracker` fields of a repo list entry. */
export const adapterEntry = { forge: PLUGIN.forge, tracker: PLUGIN.tracker };

function folderOf(claudeDir: string, role: Role): string {
  return path.join(claudeDir, "plugins", "cache", "synthetic", PLUGIN[role], "1.0.0");
}

/** Installs the synthetic adapters of both roles into a synthetic config folder. */
export async function installAdapters(claudeDir: string, roles: Role[] = ["tracker", "forge"]) {
  const plugins: Record<string, unknown[]> = {};
  for (const role of roles) {
    const folder = folderOf(claudeDir, role);
    await mkdir(path.join(folder, ".claude-plugin"), { recursive: true });
    await copyFile(SCRIPT, path.join(folder, "scenario_adapter.py"));
    await writeFile(
      path.join(folder, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: PLUGIN[role],
        factory_adapter: {
          role,
          command: "scenario_adapter.py",
          token_env: "SYNTH_TOKEN",
          token_prefix: "github_pat_",
        },
      }),
    );
    plugins[`${PLUGIN[role]}@synthetic`] = [
      { scope: "user", installPath: folder, version: "1.0.0" },
    ];
  }
  await mkdir(path.join(claudeDir, "plugins"), { recursive: true });
  await writeFile(
    path.join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }),
  );

  return {
    async setScenario(role: Role, scenario: Scenario) {
      await writeFile(
        path.join(folderOf(claudeDir, role), "scenario.json"),
        JSON.stringify(scenario),
      );
    },
    /** The commands that the adapter got since the last call of `clearCalls`. */
    async calls(role: Role): Promise<string[]> {
      const text = await readFile(
        path.join(folderOf(claudeDir, role), "calls.jsonl"),
        "utf8",
      ).catch(() => "");
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { command: string }).command);
    },
    async clearCalls() {
      for (const role of roles) {
        await rm(path.join(folderOf(claudeDir, role), "calls.jsonl"), { force: true });
      }
    },
  };
}

export async function writeTokens(claudeDir: string, tokens: Record<string, string>) {
  const file = path.join(claudeDir, "tokens.json");
  await writeFile(file, JSON.stringify(tokens));
  return file;
}

export const BODY_TEXT = "synthetic body text that the cache must not keep";

export function issue(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    url: `https://github.com/acme/app/issues/${String(number)}`,
    title: `Issue ${String(number)}`,
    body: BODY_TEXT,
    state: "open",
    labels: ["state:ready"],
    author: "synth-author",
    issue_state: "READY",
    priority: "high",
    ...over,
  };
}

export function relations(number: number, over: Record<string, unknown> = {}) {
  return { number, parent: null, children: [], blocked_by: [], ...over };
}

export function pull(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    url: `https://github.com/acme/app/pull/${String(number)}`,
    title: `Pull ${String(number)}`,
    state: "open",
    draft: false,
    head: `branch-${String(number)}`,
    base: "main",
    author: "synth-author",
    checks: "success",
    labels: [],
    ...over,
  };
}

export function review(author: string, over: Record<string, unknown> = {}) {
  return {
    author,
    state: "APPROVED",
    commit: "abc1234",
    body: BODY_TEXT,
    time: "2026-01-02T03:04:05Z",
    ...over,
  };
}

export function release(name: string, state: "open" | "released", issues: number[] = []) {
  return { name, url: `https://github.com/acme/app/milestone/1`, state, issues };
}

export function forgeRelease(tag: string, over: Record<string, unknown> = {}) {
  return {
    tag,
    url: `https://github.com/acme/app/releases/tag/${tag}`,
    target: "deadbeef",
    assets: ["app.tgz"],
    ...over,
  };
}

/** The answers of a tracker adapter for these lists. */
export function trackerScenario(
  all: unknown[],
  open: unknown[],
  releases: unknown[],
  relationsFor: Record<number, unknown> = {},
): Scenario {
  const scenario: Scenario = {
    "issue list --state all": { ok: all },
    "issue list --state open": { ok: open },
    "release list --state all": { ok: releases },
  };
  for (const item of all) {
    const number = (item as { number: number }).number;
    scenario[`issue relations ${String(number)}`] = {
      ok: relationsFor[number] ?? relations(number),
    };
  }
  return scenario;
}

/** The answers of a forge adapter for these lists. */
export function forgeScenario(
  all: unknown[],
  open: unknown[],
  reviewsFor: Record<number, unknown[]> = {},
  views: Record<string, unknown> = {},
): Scenario {
  const scenario: Scenario = {
    "pr list --state all": { ok: all },
    "pr list --state open": { ok: open },
  };
  for (const item of all) {
    const number = (item as { number: number }).number;
    scenario[`pr reviews ${String(number)}`] = { ok: reviewsFor[number] ?? [] };
  }
  for (const [tag, answer] of Object.entries(views)) {
    scenario[`release view ${tag}`] = { ok: answer };
  }
  return scenario;
}
