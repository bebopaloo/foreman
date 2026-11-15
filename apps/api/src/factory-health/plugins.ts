import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { MarketplaceRow, PluginRow, PluginState } from "@foreman/shared";
import { z } from "zod";
import { compareSemVer, parseSemVer } from "./semver.ts";

const MAX_FILE_BYTES = 1_048_576;
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/;

const installedSchema = z
  .object({
    plugins: z.record(
      z.string(),
      z.array(
        z
          .object({
            scope: z.string(),
            version: z.unknown().optional(),
            lastUpdated: z.unknown().optional(),
          })
          .loose(),
      ),
    ),
  })
  .loose();

const knownSchema = z.record(
  z.string(),
  z
    .object({
      source: z.object({ source: z.string() }).loose().optional(),
      installLocation: z.string().optional(),
      lastUpdated: z.unknown().optional(),
    })
    .loose(),
);

const marketplaceFileSchema = z
  .object({
    plugins: z.array(
      z
        .object({
          name: z.string(),
          version: z.unknown().optional(),
          source: z.unknown().optional(),
        })
        .loose(),
    ),
  })
  .loose();

const pluginManifestSchema = z.object({ version: z.unknown().optional() }).loose();

type FileRead<T> = { kind: "ok"; data: T } | { kind: "missing" } | { kind: "skipped" };

export interface PluginVersions {
  pluginData: "ok" | "missing";
  marketplaces: MarketplaceRow[];
  rows: PluginRow[];
  /** The base names of the files that were skipped: too large, not JSON, or not the expected shape. */
  skippedFiles: string[];
}

export interface PluginVersionsOptions {
  claudeDir: string;
  /** The folder of the one `directory` Marketplace that Foreman may read. */
  marketplaceDir: string | undefined;
}

function isInsideOrEqual(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await realpath(target);
  } catch {
    return undefined;
  }
}

async function readJsonFile<T>(
  file: string,
  schema: z.ZodType<T>,
  skipped: string[],
): Promise<FileRead<T>> {
  let text: string;
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) {
      skipped.push(path.basename(file));
      return { kind: "skipped" };
    }
    text = await readFile(file, "utf8");
  } catch {
    return { kind: "missing" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    skipped.push(path.basename(file));
    return { kind: "skipped" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    skipped.push(path.basename(file));
    return { kind: "skipped" };
  }
  return { kind: "ok", data: parsed.data };
}

/** Reads a JSON file below `root` only when its real path stays inside the real `root`. */
async function readJsonInside<T>(
  root: string,
  relative: string,
  schema: z.ZodType<T>,
  skipped: string[],
): Promise<FileRead<T>> {
  const real = await realpathOrUndefined(path.join(root, relative));
  if (real === undefined || !isInsideOrEqual(root, real)) return { kind: "missing" };
  return readJsonFile(real, schema, skipped);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function validVersion(value: unknown): string | undefined {
  return typeof value === "string" && VERSION_PATTERN.test(value) ? value : undefined;
}

/**
 * The real path of the Marketplace folder, or undefined when Foreman may not
 * read it. A git Marketplace is the copy that Claude Code keeps below
 * `plugins/marketplaces/`; a `directory` Marketplace is the configured folder.
 */
async function resolveMarketplaceFolder(
  pluginsDir: string,
  marketplaceDir: string | undefined,
  sourceKind: string | undefined,
  installLocation: string | undefined,
): Promise<string | undefined> {
  if (installLocation === undefined) return undefined;
  const segments = installLocation.split(/[\\/]+/);
  const index = segments.findIndex(
    (segment, position) =>
      segment === "plugins" &&
      segments[position + 1] === "marketplaces" &&
      (segments[position + 2] ?? "") !== "",
  );
  if (index !== -1) {
    const base = path.resolve(pluginsDir, "marketplaces", segments[index + 2] ?? "");
    const mounted = path.resolve(pluginsDir, ...segments.slice(index + 1));
    if (!isInsideOrEqual(base, mounted)) return undefined;
    const [realBase, realMounted] = await Promise.all([
      realpathOrUndefined(base),
      realpathOrUndefined(mounted),
    ]);
    return realBase !== undefined &&
      realMounted !== undefined &&
      isInsideOrEqual(realBase, realMounted)
      ? realMounted
      : undefined;
  }
  if (sourceKind === "directory" && marketplaceDir !== undefined) {
    const [configured, wanted] = await Promise.all([
      realpathOrUndefined(marketplaceDir),
      realpathOrUndefined(installLocation),
    ]);
    return configured !== undefined && configured === wanted ? configured : undefined;
  }
  return undefined;
}

type VersionLookup =
  | { ok: true; version: string }
  | {
      ok: false;
      state: "not_in_marketplace" | "version_not_in_marketplace_copy" | "version_not_readable";
    };

type MarketplaceFile = FileRead<z.infer<typeof marketplaceFileSchema>>;

async function marketplaceVersion(
  folder: string,
  plugin: string,
  file: MarketplaceFile,
  skipped: string[],
): Promise<VersionLookup> {
  if (file.kind !== "ok") return { ok: false, state: "version_not_readable" };
  const entry = file.data.plugins.find((candidate) => candidate.name === plugin);
  if (entry === undefined) return { ok: false, state: "not_in_marketplace" };

  if (entry.version !== undefined) {
    const version = validVersion(entry.version);
    return version === undefined
      ? { ok: false, state: "version_not_readable" }
      : { ok: true, version };
  }
  if (typeof entry.source !== "string" || !entry.source.startsWith("./")) {
    return { ok: false, state: "version_not_in_marketplace_copy" };
  }
  const relative = path.join(entry.source, ".claude-plugin", "plugin.json");
  const target = path.resolve(folder, relative);
  if (!isInsideOrEqual(folder, target)) {
    return { ok: false, state: "version_not_in_marketplace_copy" };
  }
  const real = await realpathOrUndefined(target);
  if (real !== undefined && !isInsideOrEqual(folder, real)) {
    return { ok: false, state: "version_not_in_marketplace_copy" };
  }
  const manifest = await readJsonInside(folder, relative, pluginManifestSchema, skipped);
  if (manifest.kind !== "ok") return { ok: false, state: "version_not_readable" };
  const version = validVersion(manifest.data.version);
  return version === undefined
    ? { ok: false, state: "version_not_readable" }
    : { ok: true, version };
}

function compareVersions(installed: string, available: string): PluginState {
  const left = parseSemVer(installed);
  const right = parseSemVer(available);
  if (left !== undefined && right !== undefined) {
    const order = compareSemVer(left, right);
    return order === 0 ? "current" : order < 0 ? "update_available" : "newer_than_marketplace";
  }
  return installed === available ? "current" : "differs_from_marketplace";
}

/** Reads the plugin files on each call. It makes no network call and writes nothing. */
export async function readPluginVersions({
  claudeDir,
  marketplaceDir,
}: PluginVersionsOptions): Promise<PluginVersions> {
  const skipped: string[] = [];
  const pluginsDir = path.join(claudeDir, "plugins");

  const installed = await readJsonFile(
    path.join(pluginsDir, "installed_plugins.json"),
    installedSchema,
    skipped,
  );
  if (installed.kind !== "ok") {
    return { pluginData: "missing", marketplaces: [], rows: [], skippedFiles: skipped };
  }

  const known = await readJsonFile(
    path.join(pluginsDir, "known_marketplaces.json"),
    knownSchema,
    skipped,
  );
  const knownMarketplaces = known.kind === "ok" ? known.data : {};

  const folders = new Map<string, string | undefined>();
  const marketplaces: MarketplaceRow[] = [];
  for (const [name, entry] of Object.entries(knownMarketplaces)) {
    const sourceKind = entry.source?.source;
    const folder = await resolveMarketplaceFolder(
      pluginsDir,
      marketplaceDir,
      sourceKind,
      entry.installLocation,
    );
    folders.set(name, folder);
    marketplaces.push({
      name,
      sourceKind: sourceKind ?? null,
      lastUpdated: isoOrNull(entry.lastUpdated),
      state: folder === undefined ? "not_readable" : "readable",
      localFolder: sourceKind === "directory",
    });
  }
  marketplaces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const marketplaceFiles = new Map<string, MarketplaceFile>();
  const rows: PluginRow[] = [];
  for (const [key, entries] of Object.entries(installed.data.plugins)) {
    const at = key.indexOf("@");
    const plugin = at === -1 ? key : key.slice(0, at);
    const marketplace = at === -1 ? "" : key.slice(at + 1);
    const userEntries = entries.filter((entry) => entry.scope === "user");
    const otherScopeInstalls = entries.length - userEntries.length;
    const base = {
      key,
      plugin,
      marketplace,
      installedVersion: null,
      installLastUpdated: null,
      marketplaceVersion: null,
      otherScopeInstalls,
    };
    const userEntry = userEntries[0];
    if (userEntry === undefined) {
      rows.push({ ...base, state: "no_user_install" });
      continue;
    }
    const installedVersion = validVersion(userEntry.version) ?? null;
    const row = {
      ...base,
      installedVersion,
      installLastUpdated: isoOrNull(userEntry.lastUpdated),
    };

    if (!folders.has(marketplace)) {
      rows.push({ ...row, state: "marketplace_not_known" });
      continue;
    }
    const folder = folders.get(marketplace);
    if (folder === undefined) {
      rows.push({ ...row, state: "marketplace_not_readable" });
      continue;
    }
    let file = marketplaceFiles.get(folder);
    if (file === undefined) {
      file = await readJsonInside(
        folder,
        path.join(".claude-plugin", "marketplace.json"),
        marketplaceFileSchema,
        skipped,
      );
      marketplaceFiles.set(folder, file);
    }
    const lookup = await marketplaceVersion(folder, plugin, file, skipped);
    if (!lookup.ok) {
      rows.push({ ...row, state: lookup.state });
      continue;
    }
    if (installedVersion === null) {
      rows.push({ ...row, marketplaceVersion: lookup.version, state: "version_not_readable" });
      continue;
    }
    rows.push({
      ...row,
      marketplaceVersion: lookup.version,
      state: compareVersions(installedVersion, lookup.version),
    });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { pluginData: "ok", marketplaces, rows, skippedFiles: skipped };
}
