import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A synthetic config folder. Pass an object to write `factory/repos.json`, a string to write raw text, or nothing for no file. */
export async function makeClaudeDir(repoList?: unknown): Promise<string> {
  const claudeDir = await mkdtemp(path.join(os.tmpdir(), "foreman-repos-"));
  if (repoList !== undefined) {
    await mkdir(path.join(claudeDir, "factory"), { recursive: true });
    const text = typeof repoList === "string" ? repoList : JSON.stringify(repoList);
    await writeFile(path.join(claudeDir, "factory", "repos.json"), text);
  }
  return claudeDir;
}

export function entry(repo: string, client?: string, extra: Record<string, unknown> = {}) {
  return {
    path: `/synthetic/${repo}`,
    forge: "factory-github",
    tracker: "factory-github",
    enabled: true,
    repo,
    host: "github.com",
    ...(client === undefined ? {} : { client }),
    ...extra,
  };
}

/** An entry with no `repo` field. */
export function entryWithoutRepo(client?: string) {
  const full: Record<string, unknown> = entry("x/x", client);
  delete full.repo;
  return full;
}
