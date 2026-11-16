import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdapterSmoke } from "../src/adapter-smoke.ts";

const SCRIPT = path.resolve(import.meta.dirname, "fixtures", "adapter", "synthetic_adapter.py");
const TOKEN = "github_pat_synthetic_smoke_value";

let root: string;
let claudeDir: string;
let plugin: string;
let tokensFile: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "foreman-smoke-"));
  claudeDir = path.join(root, "claude");
  plugin = path.join(claudeDir, "plugins", "cache", "market", "synthetic-forge", "1.0.0");
  tokensFile = path.join(root, "tokens.json");
  await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(claudeDir, "factory"), { recursive: true });
  await copyFile(SCRIPT, path.join(plugin, "synthetic_adapter.py"));
  await writeFile(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "synthetic-forge",
      metadata: {
        factory_adapter: {
          role: "forge",
          command: "synthetic_adapter.py",
          token_env: "SYNTH_TOKEN",
          token_prefix: "github_pat_",
        },
      },
    }),
  );
  await writeFile(
    path.join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: { "synthetic-forge@market": [{ scope: "user", installPath: plugin }] },
    }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function repoList(...repos: string[]) {
  await writeFile(
    path.join(claudeDir, "factory", "repos.json"),
    JSON.stringify({
      repos: repos.map((repo) => ({ path: `/synthetic/${repo}`, forge: "synthetic-forge", repo })),
    }),
  );
}

async function adapterOutput(stdout: string, exit = 0) {
  await writeFile(path.join(plugin, "control.json"), JSON.stringify({ stdout, exit }));
}

const run = () =>
  runAdapterSmoke({ claudeDir, tokensFile, allowedHosts: ["github.com"], timeoutMs: 20_000 });

describe("runAdapterSmoke", () => {
  it("reports connected when the forge adapter gives valid output", async () => {
    await repoList("acme/app", "acme/site");
    await writeFile(tokensFile, JSON.stringify({ "github.com/acme": TOKEN }));
    await adapterOutput("[]");
    expect(await run()).toEqual({ ok: true, lines: ["github.com/acme: connected"] });
  });

  it("reports not connected, and does not fail, when the owner has no token", async () => {
    await repoList("acme/app");
    await adapterOutput("[]");
    const result = await run();
    expect(result).toEqual({ ok: true, lines: ["github.com/acme: not connected: no token"] });
  });

  it("fails when the adapter output is not valid", async () => {
    await repoList("acme/app");
    await writeFile(tokensFile, JSON.stringify({ "github.com/acme": TOKEN }));
    await adapterOutput('{"unexpected": true}');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(1);
    expect(result.lines.join("\n")).not.toContain(TOKEN);
    expect(result.lines.join("\n")).not.toContain("unexpected");
  });

  it("fails when the token is not a fine-grained token", async () => {
    await repoList("acme/app");
    await writeFile(tokensFile, JSON.stringify({ "github.com/acme": "ghp_synthetic_classic" }));
    const result = await run();
    expect(result).toEqual({
      ok: false,
      lines: ["github.com/acme: token refused: not a fine-grained token"],
    });
  });

  it("fails when the forge adapter is not installed", async () => {
    await repoList("acme/app");
    await writeFile(
      path.join(claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: {} }),
    );
    await writeFile(tokensFile, JSON.stringify({ "github.com/acme": TOKEN }));
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual(["github.com/acme: adapter not readable by Foreman"]);
  });

  it("says that there is nothing to check without a repo list", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual(["no repo list: nothing to check"]);
  });

  it("skips a repo with no forge name", async () => {
    await writeFile(
      path.join(claudeDir, "factory", "repos.json"),
      JSON.stringify({ repos: [{ path: "/synthetic/a", repo: "acme/app" }] }),
    );
    const result = await run();
    expect(result.lines).toEqual(["github.com/acme: not connected: no forge name"]);
  });

  it("says that no repo has a forge name when every entry has no repo field", async () => {
    await writeFile(
      path.join(claudeDir, "factory", "repos.json"),
      JSON.stringify({ repos: [{ path: "/synthetic/a", forge: "synthetic-forge" }] }),
    );
    const result = await run();
    expect(result.lines).toEqual(["no repo has a forge name: nothing to check"]);
  });
});
