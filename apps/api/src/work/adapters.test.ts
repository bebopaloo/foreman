import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOT_READABLE_STATE, resolveAdapter } from "./adapters.ts";

let claudeDir: string;

beforeEach(async () => {
  claudeDir = await mkdtemp(path.join(os.tmpdir(), "foreman-adapters-"));
});

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true });
});

interface PluginOptions {
  adapter?: unknown;
  scope?: string;
  installPath?: string;
}

/** Installs a synthetic plugin below `<claudeDir>/plugins/cache`. */
async function installPlugin(key: string, options: PluginOptions = {}): Promise<string> {
  const [name = "", marketplace = ""] = key.split("@");
  const folder = path.join(claudeDir, "plugins", "cache", marketplace, name, "1.0.0");
  await mkdir(path.join(folder, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(folder, "scripts"), { recursive: true });
  await writeFile(path.join(folder, "scripts", "run.py"), "print('synthetic')\n");
  const manifest: Record<string, unknown> = { name };
  if (options.adapter !== undefined) manifest.factory_adapter = options.adapter;
  await writeFile(path.join(folder, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));

  const file = path.join(claudeDir, "plugins", "installed_plugins.json");
  let installed: { version: number; plugins: Record<string, unknown[]> } = {
    version: 2,
    plugins: {},
  };
  try {
    installed = JSON.parse(await readFile(file, "utf8")) as typeof installed;
  } catch {
    // The first plugin creates the file.
  }
  installed.plugins[key] = [
    {
      scope: options.scope ?? "user",
      installPath: options.installPath ?? folder,
      version: "1.0.0",
    },
  ];
  await writeFile(file, JSON.stringify(installed));
  return folder;
}

const forgeAdapter = {
  role: "forge",
  command: "scripts/run.py",
  token_env: "GH_TOKEN",
  token_prefix: "github_pat_",
};

describe("resolveAdapter", () => {
  it("returns the declared command line and the install folder", async () => {
    const installed = await installPlugin("factory-github@bebopaloo-factory", {
      adapter: forgeAdapter,
    });
    const folder = await realpath(installed);

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toEqual({
      ok: true,
      adapter: {
        role: "forge",
        pluginDir: folder,
        command: path.join(folder, "scripts", "run.py"),
        tokenEnv: "GH_TOKEN",
        tokenPrefix: "github_pat_",
      },
    });
  });

  it("is not readable when no key matches", async () => {
    await installPlugin("other-plugin@bebopaloo-factory", { adapter: forgeAdapter });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("is not readable when two keys have a user-scope entry", async () => {
    await installPlugin("factory-github@a", { adapter: forgeAdapter });
    await installPlugin("factory-github@b", { adapter: forgeAdapter });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("is not readable when the plugin has no factory_adapter key", async () => {
    await installPlugin("factory-github@a");

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("is not readable when the factory_adapter key is invalid", async () => {
    await installPlugin("factory-github@a", { adapter: { role: "forge" } });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it.each(["../other/run.py", "/usr/bin/env"])("refuses the command %s", async (command) => {
    await installPlugin("factory-github@a", { adapter: { ...forgeAdapter, command } });
    await mkdir(path.join(claudeDir, "plugins", "cache", "a", "factory-github", "other"), {
      recursive: true,
    });
    await writeFile(
      path.join(claudeDir, "plugins", "cache", "a", "factory-github", "other", "run.py"),
      "",
    );

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("refuses a command that is a symlink out of the plugin", async () => {
    const folder = await installPlugin("factory-github@a", { adapter: forgeAdapter });
    await rm(path.join(folder, "scripts", "run.py"));
    await symlink(
      path.join(claudeDir, "installed-outside.py"),
      path.join(folder, "scripts", "run.py"),
    );
    await writeFile(path.join(claudeDir, "installed-outside.py"), "");

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("refuses an install folder outside the plugins folder", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "foreman-outside-"));
    try {
      await mkdir(path.join(outside, ".claude-plugin"), { recursive: true });
      await mkdir(path.join(outside, "scripts"), { recursive: true });
      await writeFile(path.join(outside, "scripts", "run.py"), "");
      await writeFile(
        path.join(outside, ".claude-plugin", "plugin.json"),
        JSON.stringify({ factory_adapter: forgeAdapter }),
      );
      await installPlugin("factory-github@a", {
        adapter: forgeAdapter,
        installPath: path.join(claudeDir, "plugins", "..", "..", outside),
      });

      const result = await resolveAdapter(claudeDir, "factory-github", "forge");

      expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses an install folder that climbs out of plugins/", async () => {
    await installPlugin("factory-github@a", {
      adapter: forgeAdapter,
      installPath: "/home/x/.claude/plugins/../../elsewhere",
    });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("refuses an adapter of the wrong role", async () => {
    await installPlugin("factory-github@a", { adapter: { ...forgeAdapter, role: "tracker" } });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false, state: NOT_READABLE_STATE });
  });

  it("uses only the user-scope entry", async () => {
    await installPlugin("factory-github@a", { adapter: forgeAdapter, scope: "project" });

    const result = await resolveAdapter(claudeDir, "factory-github", "forge");

    expect(result).toMatchObject({ ok: false });
  });
});
