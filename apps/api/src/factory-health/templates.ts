import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RuleKind } from "../controls/files.ts";
import { isInsideOrEqual, MAX_FILE_BYTES, readJsonFile, realpathOrUndefined } from "./plugins.ts";

const TEMPLATE_FILE = /^([a-z0-9][a-z0-9-]*)\.md$/;
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_SEGMENT = /^[0-9A-Za-z.+_-]{1,64}$/;

const installedSchema = z
  .object({
    plugins: z.record(
      z.string(),
      z.array(
        z
          .object({
            scope: z.string(),
            version: z.unknown().optional(),
            installPath: z.unknown().optional(),
          })
          .loose(),
      ),
    ),
  })
  .loose();

/** An installed plugin that Foreman may read the templates of. */
export interface TemplateSource {
  plugin: string;
  marketplace: string;
  version: string | null;
  /** The real path of the install folder, inside `<claudeDir>/plugins/`. Never in a response. */
  folder: string;
}

interface TemplateFile {
  file: string;
  size: number;
}

/** Reads Rule templates from the installed plugins and the plugin cache. It writes nothing. */
export interface TemplateReader {
  /** The installed plugin of that name, or undefined when none or more than one counts. */
  source(plugin: string): TemplateSource | undefined;
  /** The names of the templates of a plugin, a name once. Templates over 1 MB are not listed. */
  names(plugin: string, kind: RuleKind): Promise<ReadonlySet<string>>;
  /** The SHA-256 of the installed template, or undefined when it is not readable. */
  installedHash(plugin: string, kind: RuleKind, name: string): Promise<string | undefined>;
  /** The SHA-256 of the template of `plugin` at `version` in the plugin cache, if the cache has it. */
  cachedHash(
    plugin: string,
    version: string,
    kind: RuleKind,
    name: string,
  ): Promise<string | undefined>;
  /** The count of template files that were skipped for size. */
  skippedTemplates(): number;
}

function templateFolder(root: string, kind: RuleKind): string {
  return kind === "rule"
    ? path.join(root, "templates", "rules")
    : path.join(root, "templates", "rules", "compliance");
}

/** Maps the install path of the host to the same path below `<claudeDir>/plugins/`. */
function mapInstallPath(pluginsDir: string, installPath: string): string | undefined {
  const segments = installPath.split(/[\\/]+/);
  const index = segments.findIndex(
    (segment, position) => segment === "plugins" && segments[position + 1] === "cache",
  );
  if (index === -1) return undefined;
  const rest = segments.slice(index + 1);
  if (rest.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return path.join(pluginsDir, ...rest);
}

export async function createTemplateReader(claudeDir: string): Promise<TemplateReader> {
  const pluginsDir = path.join(claudeDir, "plugins");
  const realPlugins = await realpathOrUndefined(pluginsDir);
  const sources = new Map<string, TemplateSource>();
  const skippedFiles = new Set<string>();

  const installed = await readJsonFile(
    path.join(pluginsDir, "installed_plugins.json"),
    installedSchema,
    [],
  );
  if (installed.kind === "ok" && realPlugins !== undefined) {
    const candidates = new Map<string, TemplateSource[]>();
    for (const [key, entries] of Object.entries(installed.data.plugins)) {
      const at = key.indexOf("@");
      const plugin = at === -1 ? key : key.slice(0, at);
      const marketplace = at === -1 ? "" : key.slice(at + 1);
      const userEntries = entries.filter((entry) => entry.scope === "user");
      const list = candidates.get(plugin) ?? [];
      const only = userEntries.length === 1 ? userEntries[0] : undefined;
      // A key with no single user-scope entry still counts, so a second key makes the plugin ambiguous.
      const entry = only;
      if (entry === undefined || typeof entry.installPath !== "string") {
        list.push({ plugin, marketplace, version: null, folder: "" });
        candidates.set(plugin, list);
        continue;
      }
      const mapped = mapInstallPath(pluginsDir, entry.installPath);
      const real = mapped === undefined ? undefined : await realpathOrUndefined(mapped);
      const version =
        typeof entry.version === "string" && SAFE_SEGMENT.test(entry.version)
          ? entry.version
          : null;
      list.push({
        plugin,
        marketplace,
        version,
        folder: real !== undefined && isInsideOrEqual(realPlugins, real) ? real : "",
      });
      candidates.set(plugin, list);
    }
    for (const [plugin, list] of candidates) {
      const only = list.length === 1 ? list[0] : undefined;
      if (only !== undefined && only.folder !== "" && PLUGIN_NAME.test(plugin)) {
        sources.set(plugin, only);
      }
    }
  }

  const listings = new Map<string, Promise<Map<string, TemplateFile>>>();
  const hashes = new Map<string, Promise<string | undefined>>();

  async function listFolder(root: string, kind: RuleKind): Promise<Map<string, TemplateFile>> {
    const found = new Map<string, TemplateFile>();
    const folder = templateFolder(root, kind);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return found;
    }
    for (const fileName of names.sort()) {
      const templateName = TEMPLATE_FILE.exec(fileName)?.[1];
      if (templateName === undefined) continue;
      const real = await realpathOrUndefined(path.join(folder, fileName));
      if (real === undefined || !isInsideOrEqual(root, real)) continue;
      try {
        const info = await stat(real);
        if (!info.isFile()) continue;
        if (info.size > MAX_FILE_BYTES) {
          skippedFiles.add(real);
          continue;
        }
        found.set(templateName, { file: real, size: info.size });
      } catch {
        continue;
      }
    }
    return found;
  }

  function listing(root: string, kind: RuleKind): Promise<Map<string, TemplateFile>> {
    const key = `${kind}\0${root}`;
    let cached = listings.get(key);
    if (cached === undefined) {
      cached = listFolder(root, kind);
      listings.set(key, cached);
    }
    return cached;
  }

  function hashFile(file: string): Promise<string | undefined> {
    let cached = hashes.get(file);
    if (cached === undefined) {
      cached = readFile(file, "utf8").then(
        (text) => createHash("sha256").update(text, "utf8").digest("hex"),
        () => undefined,
      );
      hashes.set(file, cached);
    }
    return cached;
  }

  async function hashIn(root: string, kind: RuleKind, name: string): Promise<string | undefined> {
    const file = (await listing(root, kind)).get(name);
    return file === undefined ? undefined : hashFile(file.file);
  }

  return {
    source: (plugin) => sources.get(plugin),
    async names(plugin, kind) {
      const source = sources.get(plugin);
      return source === undefined
        ? new Set()
        : new Set((await listing(source.folder, kind)).keys());
    },
    async installedHash(plugin, kind, name) {
      const source = sources.get(plugin);
      return source === undefined ? undefined : hashIn(source.folder, kind, name);
    },
    async cachedHash(plugin, version, kind, name) {
      const source = sources.get(plugin);
      if (source === undefined || realPlugins === undefined) return undefined;
      if (!SAFE_SEGMENT.test(version) || version === "." || version === "..") return undefined;
      if (!SAFE_SEGMENT.test(source.marketplace) || source.marketplace.startsWith(".")) {
        return undefined;
      }
      const folder = path.join(pluginsDir, "cache", source.marketplace, plugin, version);
      const real = await realpathOrUndefined(folder);
      if (real === undefined || !isInsideOrEqual(path.join(realPlugins, "cache"), real)) {
        return undefined;
      }
      return hashIn(real, kind, name);
    },
    skippedTemplates: () => skippedFiles.size,
  };
}
