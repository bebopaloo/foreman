import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readRepoList } from "@foreman/api/repo-list";

const run = promisify(execFile);

/** The Keychain service of the Foreman tokens. The account is `<host>/<owner>`. */
const SERVICE = "foreman";

/** The distinct `<host>/<owner>` accounts of the repos, in lower case and sorted. */
export function tokenAccounts(repos: readonly { host: string; owner: string | null }[]): string[] {
  const accounts = new Set<string>();
  for (const repo of repos) {
    if (repo.owner !== null) accounts.add(`${repo.host}/${repo.owner}`.toLowerCase());
  }
  return [...accounts].sort();
}

/** Reads one Keychain item. A missing item, or a failed `security`, gives `undefined`. */
async function readItem(securityCommand: string, account: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(
      securityCommand,
      ["find-generic-password", "-s", SERVICE, "-a", account, "-w"],
      { timeout: 30_000 },
    );
    const value = stdout.trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

export interface CollectOptions {
  claudeDir: string;
  /** The `security` command; a test passes a fake. */
  securityCommand?: string;
}

/**
 * Reads the token of each host and owner in the repo list from the Keychain.
 * A missing item is a missing key. The result holds secrets: never log it.
 */
export async function collectTokens(options: CollectOptions): Promise<Record<string, string>> {
  const list = await readRepoList(options.claudeDir);
  if (list.status !== "ok") return {};
  const tokens: Record<string, string> = {};
  for (const account of tokenAccounts(list.repos)) {
    const value = await readItem(options.securityCommand ?? "security", account);
    if (value !== undefined) tokens[account] = value;
  }
  return tokens;
}

if (import.meta.main) {
  const claudeDir = path.resolve(
    process.env.FOREMAN_CLAUDE_DIR ?? path.join(os.homedir(), ".claude-bebopaloo"),
  );
  process.stdout.write(JSON.stringify(await collectTokens({ claudeDir })));
}
