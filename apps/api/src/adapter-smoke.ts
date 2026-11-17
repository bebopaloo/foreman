import { loadConfig } from "./config.ts";
import { resolveAdapter } from "./work/adapters.ts";
import { readRepoList } from "./work/repo-list.ts";
import { runAdapterCommand } from "./work/runner.ts";
import { NO_TOKEN_STATE, readTokens, resolveToken, type TokenSource } from "./work/tokens.ts";

export interface SmokeOptions {
  claudeDir: string;
  tokenSource: TokenSource;
  allowedHosts: readonly string[];
  timeoutMs: number;
}

export interface SmokeResult {
  /** True when no connected owner failed. An owner with no token is not a failure. */
  ok: boolean;
  /** One line for each `<host>/<owner>`. A line never holds a token or adapter output. */
  lines: string[];
}

/**
 * Runs one allow-listed read command (`pr list --state open`) through the installed
 * forge adapter, for the first repo of each host and owner, with that owner's token.
 */
export async function runAdapterSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const list = await readRepoList(options.claudeDir);
  if (list.status !== "ok") return { ok: true, lines: ["no repo list: nothing to check"] };
  const tokens = await readTokens(options.tokenSource);

  const first = new Map<string, { host: string; repo: string; forge: string | null }>();
  for (const repo of list.repos) {
    if (repo.owner === null || repo.name === null) continue;
    const key = `${repo.host}/${repo.owner}`.toLowerCase();
    if (!first.has(key)) {
      first.set(key, { host: repo.host, repo: `${repo.owner}/${repo.name}`, forge: repo.forge });
    }
  }

  const lines: string[] = [];
  let ok = true;
  for (const [key, target] of [...first].sort(([a], [b]) => a.localeCompare(b))) {
    const owner = key.slice(key.indexOf("/") + 1);
    if (target.forge === null) {
      lines.push(`${key}: not connected: no forge name`);
      continue;
    }
    const resolved = await resolveAdapter(options.claudeDir, target.forge, "forge");
    if (!resolved.ok) {
      ok = false;
      lines.push(`${key}: ${resolved.state}`);
      continue;
    }
    const token = resolveToken(tokens, target.host, owner, resolved.adapter);
    if (!token.ok) {
      // A missing token is a normal state of the stack; a refused token is a set-up fault.
      if (token.state !== NO_TOKEN_STATE) ok = false;
      lines.push(`${key}: ${token.state}`);
      continue;
    }
    const result = await runAdapterCommand(
      {
        adapter: resolved.adapter,
        host: target.host,
        repo: target.repo,
        token: token.token,
        command: ["pr", "list", "--state", "open"],
      },
      { allowedHosts: options.allowedHosts, timeoutMs: options.timeoutMs },
    );
    if (result.ok) {
      lines.push(`${key}: connected`);
    } else {
      ok = false;
      lines.push(`${key}: ${result.state}`);
    }
  }
  if (lines.length === 0) lines.push("no repo has a forge name: nothing to check");
  return { ok, lines };
}

if (import.meta.main) {
  const config = loadConfig();
  const result = await runAdapterSmoke({
    claudeDir: config.FOREMAN_CLAUDE_DIR,
    tokenSource: config.FOREMAN_TOKENS_JSON ?? config.FOREMAN_TOKENS_FILE,
    allowedHosts: config.FOREMAN_ALLOWED_HOSTS,
    timeoutMs: config.FOREMAN_ADAPTER_TIMEOUT_SECONDS * 1000,
  });
  for (const line of result.lines) console.log(line);
  process.exitCode = result.ok ? 0 : 1;
}
