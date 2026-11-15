import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectTokens, tokenAccounts } from "./keychain-tokens.ts";

let folder: string;
let claudeDir: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "foreman-keychain-"));
  claudeDir = path.join(folder, "claude");
  await mkdir(path.join(claudeDir, "factory"), { recursive: true });
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function writeRepoList(repos: unknown[]) {
  await writeFile(path.join(claudeDir, "factory", "repos.json"), JSON.stringify({ repos }));
}

/** A fake `security`: it knows the accounts in `items`, and exits 44 for any other. */
async function fakeSecurity(items: Record<string, string>): Promise<string> {
  const cases = Object.entries(items)
    .map(([account, value]) => `  "${account}") printf '%s\\n' '${value}' ;;`)
    .join("\n");
  const script = `#!/usr/bin/env bash
if [ "$1" != "find-generic-password" ] || [ "$2" != "-s" ] || [ "$3" != "foreman" ] || [ "$4" != "-a" ] || [ "$6" != "-w" ]; then exit 2; fi
case "$5" in
${cases}
  *) echo "security: item not found" >&2; exit 44 ;;
esac
`;
  const file = path.join(folder, "security");
  await writeFile(file, script);
  await chmod(file, 0o755);
  return file;
}

const entry = (repo: string, host?: string) => ({
  path: `/synthetic/${repo}`,
  repo,
  ...(host === undefined ? {} : { host }),
});

describe("tokenAccounts", () => {
  it("lists each host and owner once, in lower case, sorted", () => {
    const accounts = tokenAccounts([
      { host: "github.com", owner: "Acme" },
      { host: "github.com", owner: "acme" },
      { host: "github.com", owner: "bebopaloo" },
      { host: "ghe.example.test", owner: "zed" },
      { host: "github.com", owner: null },
    ]);
    expect(accounts).toEqual(["ghe.example.test/zed", "github.com/acme", "github.com/bebopaloo"]);
  });
});

describe("collectTokens", () => {
  it("reads one Keychain item for each host and owner", async () => {
    await writeRepoList([entry("acme/app"), entry("acme/site"), entry("bebopaloo/tools")]);
    const security = await fakeSecurity({
      "github.com/acme": "github_pat_synthetic_one",
      "github.com/bebopaloo": "github_pat_synthetic_two",
    });
    const tokens = await collectTokens({ claudeDir, securityCommand: security });
    expect(tokens).toEqual({
      "github.com/acme": "github_pat_synthetic_one",
      "github.com/bebopaloo": "github_pat_synthetic_two",
    });
  });

  it("leaves out an owner with no Keychain item", async () => {
    await writeRepoList([entry("acme/app"), entry("bebopaloo/tools")]);
    const security = await fakeSecurity({ "github.com/acme": "github_pat_synthetic_one" });
    const tokens = await collectTokens({ claudeDir, securityCommand: security });
    expect(tokens).toEqual({ "github.com/acme": "github_pat_synthetic_one" });
  });

  it("gives an empty object when no Keychain item exists", async () => {
    await writeRepoList([entry("acme/app")]);
    const security = await fakeSecurity({});
    expect(await collectTokens({ claudeDir, securityCommand: security })).toEqual({});
  });

  it("gives an empty object when the `security` command is missing", async () => {
    await writeRepoList([entry("acme/app")]);
    const tokens = await collectTokens({
      claudeDir,
      securityCommand: path.join(folder, "no-such-command"),
    });
    expect(tokens).toEqual({});
  });

  it("gives an empty object when the repo list is missing", async () => {
    await rm(path.join(claudeDir, "factory"), { recursive: true });
    const security = await fakeSecurity({ "github.com/acme": "github_pat_synthetic_one" });
    expect(await collectTokens({ claudeDir, securityCommand: security })).toEqual({});
  });

  it("uses the host of an entry", async () => {
    await writeRepoList([entry("acme/app", "ghe.example.test")]);
    const security = await fakeSecurity({ "ghe.example.test/acme": "ghp_synthetic" });
    const tokens = await collectTokens({ claudeDir, securityCommand: security });
    expect(tokens).toEqual({ "ghe.example.test/acme": "ghp_synthetic" });
  });

  it("ignores an item with an empty value", async () => {
    await writeRepoList([entry("acme/app")]);
    const security = await fakeSecurity({ "github.com/acme": "" });
    expect(await collectTokens({ claudeDir, securityCommand: security })).toEqual({});
  });
});
