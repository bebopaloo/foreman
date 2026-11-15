import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const NOT_READABLE_STATE = "adapter not readable by Foreman";

export type AdapterRole = "forge" | "tracker";

export interface ResolvedAdapter {
  role: AdapterRole;
  /** The install folder: the working folder of the plugin, inside `<claudeDir>/plugins/`. */
  pluginDir: string;
  /** The absolute path of the declared command, inside `pluginDir`. */
  command: string;
  tokenEnv: string;
  tokenPrefix: string;
}

export type AdapterResolution =
  | { ok: true; adapter: ResolvedAdapter }
  | { ok: false; state: typeof NOT_READABLE_STATE; reason: string };

const installedPluginsSchema = z.object({
  plugins: z.record(
    z.string(),
    z.array(z.object({ scope: z.string(), installPath: z.string() }).loose()),
  ),
});

const manifestSchema = z.object({ factory_adapter: z.unknown().optional() }).loose();

const adapterKeySchema = z
  .object({
    role: z.enum(["forge", "tracker"]),
    command: z.string().min(1),
    token_env: z.string().min(1),
    token_prefix: z.string().min(1),
  })
  .strict();

function refuse(reason: string): AdapterResolution {
  return { ok: false, state: NOT_READABLE_STATE, reason };
}

function isInside(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * Maps the install folder of a plugin to the mounted config folder, by the
 * part of the path below the `plugins/` folder that holds `cache/`.
 */
function mountInstallPath(pluginsDir: string, installPath: string): string | undefined {
  const segments = installPath.split(/[\\/]+/);
  const index = segments.findIndex(
    (segment, position) => segment === "plugins" && segments[position + 1] === "cache",
  );
  if (index === -1) return undefined;
  const mounted = path.resolve(pluginsDir, ...segments.slice(index + 1));
  return isInside(pluginsDir, mounted) ? mounted : undefined;
}

/**
 * Finds the installed plugin that a repo list entry names, and reads the
 * `factory_adapter` key of its `plugin.json`. It starts no subprocess.
 */
export async function resolveAdapter(
  claudeDir: string,
  plugin: string,
  role: AdapterRole,
): Promise<AdapterResolution> {
  const pluginsDir = path.join(claudeDir, "plugins");

  let installed;
  try {
    installed = installedPluginsSchema.parse(
      await readJson(path.join(pluginsDir, "installed_plugins.json")),
    );
  } catch {
    return refuse("installed_plugins.json is missing or invalid");
  }

  const matches = Object.entries(installed.plugins)
    .filter(([key]) => key.split("@")[0] === plugin)
    .flatMap(([, entries]) => entries.filter((entry) => entry.scope === "user"));
  if (matches.length !== 1 || matches[0] === undefined) {
    return refuse(`${String(matches.length)} user-scope installs of ${plugin}`);
  }

  const mounted = mountInstallPath(pluginsDir, matches[0].installPath);
  if (mounted === undefined) return refuse("install folder is outside the plugins folder");

  let pluginDir: string;
  let realPluginsDir: string;
  try {
    realPluginsDir = await realpath(pluginsDir);
    pluginDir = await realpath(mounted);
  } catch {
    return refuse("install folder is missing");
  }
  if (!isInside(realPluginsDir, pluginDir)) {
    return refuse("install folder is outside the plugins folder");
  }

  let key;
  try {
    const manifest = manifestSchema.parse(
      await readJson(path.join(pluginDir, ".claude-plugin", "plugin.json")),
    );
    key = adapterKeySchema.parse(manifest.factory_adapter);
  } catch {
    return refuse("plugin.json has no valid factory_adapter key");
  }

  if (key.role !== role) return refuse(`adapter role is ${key.role}, not ${role}`);

  if (path.isAbsolute(key.command)) return refuse("adapter command is an absolute path");
  let command: string;
  try {
    command = await realpath(path.resolve(pluginDir, key.command));
    if (!(await stat(command)).isFile()) return refuse("adapter command is not a file");
  } catch {
    return refuse("adapter command is missing");
  }
  if (!isInside(pluginDir, command)) return refuse("adapter command is outside its plugin");

  return {
    ok: true,
    adapter: {
      role: key.role,
      pluginDir,
      command,
      tokenEnv: key.token_env,
      tokenPrefix: key.token_prefix,
    },
  };
}
