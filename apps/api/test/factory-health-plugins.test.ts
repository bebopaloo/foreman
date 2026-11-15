import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginVersionsResponse } from "@foreman/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, testConfig } from "./database.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

interface MarketplaceEntry {
  name: string;
  version?: string;
  source?: unknown;
}

interface Marketplace {
  /** Plugin versions in `<source>/.claude-plugin/plugin.json`, for `./plugins/<name>` sources. */
  entries: MarketplaceEntry[];
  manifests?: Record<string, string>;
}

async function tempFolder(): Promise<string> {
  return realpath(await mkdtemp(path.join(os.tmpdir(), "foreman-plugins-")));
}

async function writeMarketplace(folder: string, marketplace: Marketplace): Promise<void> {
  await mkdir(path.join(folder, ".claude-plugin"), { recursive: true });
  await writeFile(
    path.join(folder, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "demo", plugins: marketplace.entries }),
  );
  for (const [name, version] of Object.entries(marketplace.manifests ?? {})) {
    const manifest = path.join(folder, "plugins", name, ".claude-plugin");
    await mkdir(manifest, { recursive: true });
    await writeFile(path.join(manifest, "plugin.json"), JSON.stringify({ name, version }));
  }
}

function install(version: string, scope = "user"): unknown {
  return {
    scope,
    installPath: "/home/operator/.claude/plugins/cache/demo-market/x/1",
    version,
    lastUpdated: "2026-11-01T09:00:00.000Z",
    gitCommitSha: "0000000",
  };
}

interface Setup {
  installs?: Record<string, unknown[]>;
  known?: Record<string, unknown>;
  rawInstalled?: string;
  marketplaceDir?: string;
}

async function appFor(setup: Setup) {
  const claudeDir = await tempFolder();
  const plugins = path.join(claudeDir, "plugins");
  await mkdir(plugins, { recursive: true });
  if (setup.rawInstalled !== undefined) {
    await writeFile(path.join(plugins, "installed_plugins.json"), setup.rawInstalled);
  } else if (setup.installs !== undefined) {
    await writeFile(
      path.join(plugins, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: setup.installs }),
    );
  }
  if (setup.known !== undefined) {
    await writeFile(path.join(plugins, "known_marketplaces.json"), JSON.stringify(setup.known));
  }
  const config = {
    ...testConfig,
    FOREMAN_CLAUDE_DIR: claudeDir,
    FOREMAN_MARKETPLACE_DIR: setup.marketplaceDir,
  };
  const app = await buildApp({ config, db: database.db, logger: false });
  return { app, claudeDir };
}

async function getPlugins(setup: Setup, query = ""): Promise<PluginVersionsResponse> {
  const { app } = await appFor(setup);
  const response = await app.inject({ method: "GET", url: `/api/factory-health/plugins${query}` });
  await app.close();
  expect(response.statusCode).toBe(200);
  return response.json<PluginVersionsResponse>();
}

function rowOf(body: PluginVersionsResponse, key: string) {
  const row = body.items.find((item) => item.key === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row;
}

/** A `directory` Marketplace in a synthetic folder, with its known_marketplaces entry. */
async function directoryMarketplace(marketplace: Marketplace) {
  const folder = await tempFolder();
  await writeMarketplace(folder, marketplace);
  const known = {
    "demo-market": {
      source: { source: "directory", path: folder },
      installLocation: folder,
      lastUpdated: "2026-11-02T10:00:00.000Z",
    },
  };
  return { folder, known };
}

describe("GET /api/factory-health/plugins", () => {
  it("shows an update that is available and a plugin that is current", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [
        { name: "factory-core", source: "./plugins/factory-core" },
        { name: "stack-ts", source: "./plugins/stack-ts" },
      ],
      manifests: { "factory-core": "0.37.5", "stack-ts": "0.10.0" },
    });
    const body = await getPlugins({
      installs: {
        "factory-core@demo-market": [install("0.30.0")],
        "stack-ts@demo-market": [install("0.10.0")],
      },
      known,
      marketplaceDir: folder,
    });
    expect(body.pluginData).toBe("ok");
    expect(rowOf(body, "factory-core@demo-market")).toEqual({
      key: "factory-core@demo-market",
      plugin: "factory-core",
      marketplace: "demo-market",
      installedVersion: "0.30.0",
      installLastUpdated: "2026-11-01T09:00:00.000Z",
      marketplaceVersion: "0.37.5",
      state: "update_available",
      otherScopeInstalls: 0,
    });
    expect(rowOf(body, "stack-ts@demo-market").state).toBe("current");
    expect(body.marketplaces).toEqual([
      {
        name: "demo-market",
        sourceKind: "directory",
        lastUpdated: "2026-11-02T10:00:00.000Z",
        state: "readable",
        localFolder: true,
      },
    ]);
    expect(body.nextCursor).toBeNull();
    expect(body.skipped).toEqual({ files: 0 });
  });

  it("compares versions as SemVer, not as text", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [{ name: "a", version: "0.10.0" }],
    });
    const body = await getPlugins({
      installs: { "a@demo-market": [install("0.9.0")] },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "a@demo-market").state).toBe("update_available");
  });

  it("takes the version in the Marketplace entry before the plugin.json version", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [{ name: "factory-github", version: "0.12.0", source: "./plugins/factory-github" }],
      manifests: { "factory-github": "0.11.0" },
    });
    const body = await getPlugins({
      installs: { "factory-github@demo-market": [install("0.12.0")] },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "factory-github@demo-market")).toMatchObject({
      marketplaceVersion: "0.12.0",
      state: "current",
    });
  });

  it("shows an install that is newer than the Marketplace copy", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [{ name: "factory-github", version: "0.8.0" }],
    });
    const body = await getPlugins({
      installs: { "factory-github@demo-market": [install("0.12.0")] },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "factory-github@demo-market").state).toBe("newer_than_marketplace");
  });

  it("compares versions that are not SemVer as text", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [
        { name: "same", version: "abc1234" },
        { name: "other", version: "def5678" },
      ],
    });
    const body = await getPlugins({
      installs: {
        "same@demo-market": [install("abc1234")],
        "other@demo-market": [install("abc1234")],
      },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "same@demo-market").state).toBe("current");
    expect(rowOf(body, "other@demo-market").state).toBe("differs_from_marketplace");
  });

  it("shows a version that fails the version rule as not readable", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [
        { name: "a", version: "1.0.0" },
        { name: "b", version: "bad version!" },
      ],
    });
    const body = await getPlugins({
      installs: {
        "a@demo-market": [install("not a version")],
        "b@demo-market": [install("1.0.0")],
      },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "a@demo-market")).toMatchObject({
      installedVersion: null,
      state: "version_not_readable",
    });
    expect(rowOf(body, "b@demo-market").state).toBe("version_not_readable");
  });

  describe("a Marketplace in a local folder", () => {
    it("is not readable without FOREMAN_MARKETPLACE_DIR", async () => {
      const { known } = await directoryMarketplace({ entries: [{ name: "a", version: "2.0.0" }] });
      const body = await getPlugins({ installs: { "a@demo-market": [install("1.0.0")] }, known });
      expect(rowOf(body, "a@demo-market")).toMatchObject({
        installedVersion: "1.0.0",
        marketplaceVersion: null,
        state: "marketplace_not_readable",
      });
      expect(body.marketplaces[0]).toMatchObject({ state: "not_readable", localFolder: true });
    });

    it("is not readable when FOREMAN_MARKETPLACE_DIR names another folder", async () => {
      const { known } = await directoryMarketplace({ entries: [{ name: "a", version: "2.0.0" }] });
      const body = await getPlugins({
        installs: { "a@demo-market": [install("1.0.0")] },
        known,
        marketplaceDir: await tempFolder(),
      });
      expect(rowOf(body, "a@demo-market").state).toBe("marketplace_not_readable");
    });

    it("is read when FOREMAN_MARKETPLACE_DIR is its folder, also through a symlink", async () => {
      const { folder, known } = await directoryMarketplace({
        entries: [{ name: "a", version: "2.0.0" }],
      });
      const link = path.join(await tempFolder(), "link");
      await symlink(folder, link);
      const body = await getPlugins({
        installs: { "a@demo-market": [install("1.0.0")] },
        known,
        marketplaceDir: link,
      });
      expect(rowOf(body, "a@demo-market")).toMatchObject({
        marketplaceVersion: "2.0.0",
        state: "update_available",
      });
    });
  });

  it("reads a git Marketplace from its copy below plugins/marketplaces", async () => {
    const claudeDir = await tempFolder();
    const copy = path.join(claudeDir, "plugins", "marketplaces", "demo-market");
    await writeMarketplace(copy, { entries: [{ name: "a", version: "3.0.0" }] });
    await writeFile(
      path.join(claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "a@demo-market": [install("2.0.0")] } }),
    );
    await writeFile(
      path.join(claudeDir, "plugins", "known_marketplaces.json"),
      JSON.stringify({
        "demo-market": {
          source: { source: "github", repo: "demo/market" },
          installLocation: "/home/operator/.claude/plugins/marketplaces/demo-market",
          lastUpdated: "2026-11-03T08:00:00.000Z",
        },
      }),
    );
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
    });
    const response = await app.inject({ method: "GET", url: "/api/factory-health/plugins" });
    await app.close();
    const body = response.json<PluginVersionsResponse>();
    expect(rowOf(body, "a@demo-market").state).toBe("update_available");
    expect(body.marketplaces[0]).toMatchObject({ sourceKind: "github", localFolder: false });
  });

  it("does not map an installLocation that climbs out of plugins/marketplaces", async () => {
    const claudeDir = await tempFolder();
    const outside = path.join(claudeDir, "plugins", "elsewhere");
    await writeMarketplace(outside, { entries: [{ name: "a", version: "3.0.0" }] });
    await writeFile(
      path.join(claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "a@demo-market": [install("2.0.0")] } }),
    );
    await writeFile(
      path.join(claudeDir, "plugins", "known_marketplaces.json"),
      JSON.stringify({
        "demo-market": {
          source: { source: "github", repo: "demo/market" },
          installLocation:
            "/home/operator/.claude/plugins/marketplaces/demo-market/../../elsewhere",
        },
      }),
    );
    const app = await buildApp({
      config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
      db: database.db,
      logger: false,
    });
    const response = await app.inject({ method: "GET", url: "/api/factory-health/plugins" });
    await app.close();
    expect(rowOf(response.json<PluginVersionsResponse>(), "a@demo-market").state).toBe(
      "marketplace_not_readable",
    );
  });

  describe("a plugin source outside the Marketplace", () => {
    it("reads no file outside the Marketplace folder", async () => {
      const parent = await tempFolder();
      const folder = path.join(parent, "market", "inner");
      const outside = path.join(parent, "outside", ".claude-plugin");
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "plugin.json"), JSON.stringify({ version: "9.9.9" }));
      await writeMarketplace(folder, {
        entries: [
          { name: "relative", source: "../../outside" },
          { name: "dotted", source: "./../../outside" },
          { name: "absolute", source: path.join(parent, "outside") },
          { name: "object", source: { source: "url", url: "https://git.example.test/x.git" } },
        ],
      });
      const known = {
        "demo-market": {
          source: { source: "directory", path: folder },
          installLocation: folder,
        },
      };
      const names = ["relative", "dotted", "absolute", "object"];
      const body = await getPlugins({
        installs: Object.fromEntries(
          names.map((name) => [`${name}@demo-market`, [install("1.0.0")]]),
        ),
        known,
        marketplaceDir: folder,
      });
      for (const name of names) {
        expect(rowOf(body, `${name}@demo-market`)).toMatchObject({
          marketplaceVersion: null,
          state: "version_not_in_marketplace_copy",
        });
      }
    });

    it("does not follow a plugin.json symlink out of the Marketplace folder", async () => {
      const outside = path.join(await tempFolder(), "plugin.json");
      await writeFile(outside, JSON.stringify({ version: "9.9.9" }));
      const folder = await tempFolder();
      await writeMarketplace(folder, { entries: [{ name: "a", source: "./plugins/a" }] });
      await mkdir(path.join(folder, "plugins", "a", ".claude-plugin"), { recursive: true });
      await symlink(outside, path.join(folder, "plugins", "a", ".claude-plugin", "plugin.json"));
      const body = await getPlugins({
        installs: { "a@demo-market": [install("1.0.0")] },
        known: { "demo-market": { source: { source: "directory" }, installLocation: folder } },
        marketplaceDir: folder,
      });
      expect(rowOf(body, "a@demo-market")).toMatchObject({
        marketplaceVersion: null,
        state: "version_not_in_marketplace_copy",
      });
    });
  });

  it("shows a plugin or a Marketplace that is not known", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [{ name: "factory-core", version: "1.0.0" }],
    });
    const body = await getPlugins({
      installs: {
        "factory-extra@demo-market": [install("1.0.0")],
        "tool@other-market": [install("1.0.0")],
      },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "factory-extra@demo-market").state).toBe("not_in_marketplace");
    expect(rowOf(body, "tool@other-market").state).toBe("marketplace_not_known");
  });

  it("compares the user-scope install and counts the installs in other scopes", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [
        { name: "stack-ts", version: "0.10.0" },
        { name: "only-project", version: "1.0.0" },
      ],
    });
    const body = await getPlugins({
      installs: {
        "stack-ts@demo-market": [
          install("0.10.0", "project"),
          install("0.10.0", "user"),
          install("0.1.0", "project"),
        ],
        "only-project@demo-market": [install("0.5.0", "project")],
      },
      known,
      marketplaceDir: folder,
    });
    expect(rowOf(body, "stack-ts@demo-market")).toMatchObject({
      installedVersion: "0.10.0",
      state: "current",
      otherScopeInstalls: 2,
    });
    expect(rowOf(body, "only-project@demo-market")).toMatchObject({
      installedVersion: null,
      state: "no_user_install",
      otherScopeInstalls: 1,
    });
  });

  describe("no plugin files", () => {
    const empty = { pluginData: "missing", marketplaces: [], items: [], nextCursor: null };

    it("reports missing data when installed_plugins.json does not exist", async () => {
      const body = await getPlugins({});
      expect(body).toMatchObject(empty);
      expect(body.skipped).toEqual({ files: 0 });
    });

    it("reports missing data, and counts the file, when it is not valid JSON", async () => {
      const body = await getPlugins({ rawInstalled: "{ not json" });
      expect(body).toMatchObject(empty);
      expect(body.skipped).toEqual({ files: 1 });
    });

    it("skips a file that is larger than 1 MB", async () => {
      const body = await getPlugins({ rawInstalled: ` ${" ".repeat(1_048_576)}{}` });
      expect(body).toMatchObject(empty);
      expect(body.skipped).toEqual({ files: 1 });
    });

    it("skips a file that does not have the expected shape", async () => {
      const body = await getPlugins({ rawInstalled: JSON.stringify({ plugins: [] }) });
      expect(body).toMatchObject(empty);
      expect(body.skipped).toEqual({ files: 1 });
    });
  });

  it("counts a Marketplace file that is not valid and shows its plugins as not readable", async () => {
    const folder = await tempFolder();
    await mkdir(path.join(folder, ".claude-plugin"), { recursive: true });
    await writeFile(path.join(folder, ".claude-plugin", "marketplace.json"), "{ nope");
    const body = await getPlugins({
      installs: { "a@demo-market": [install("1.0.0")], "b@demo-market": [install("1.0.0")] },
      known: { "demo-market": { source: { source: "directory" }, installLocation: folder } },
      marketplaceDir: folder,
    });
    expect(body.items.map((row) => row.state)).toEqual([
      "version_not_readable",
      "version_not_readable",
    ]);
    expect(body.skipped).toEqual({ files: 1 });
  });

  it("refuses a client value with status 400", async () => {
    const { app } = await appFor({});
    const response = await app.inject({
      method: "GET",
      url: "/api/factory-health/plugins?client=acme",
    });
    await app.close();
    expect(response.statusCode).toBe(400);
  });

  it("pages the rows with limit and cursor", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: ["a", "b", "c"].map((name) => ({ name, version: "1.0.0" })),
    });
    const setup = {
      installs: Object.fromEntries(
        ["c", "a", "b"].map((n) => [`${n}@demo-market`, [install("1.0.0")]]),
      ),
      known,
      marketplaceDir: folder,
    };
    const first = await getPlugins(setup, "?limit=2");
    expect(first.items.map((row) => row.plugin)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await getPlugins(
      setup,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );
    expect(second.items.map((row) => row.plugin)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
    expect(second.marketplaces).toEqual(first.marketplaces);
  });

  it("refuses a limit above 500, an unknown query key and a bad cursor", async () => {
    const { app } = await appFor({});
    for (const query of ["?limit=501", "?limit=0", "?extra=1", "?cursor=not%20a%20cursor"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/factory-health/plugins${query}`,
      });
      expect(response.statusCode, query).toBe(400);
    }
    await app.close();
  });

  it("holds no local path in the response", async () => {
    const { folder, known } = await directoryMarketplace({
      entries: [{ name: "a", source: "./plugins/a" }],
      manifests: { a: "2.0.0" },
    });
    const { app, claudeDir } = await appFor({
      installs: { "a@demo-market": [install("1.0.0")], "b@missing": [install("1.0.0")] },
      known,
      marketplaceDir: folder,
    });
    const response = await app.inject({ method: "GET", url: "/api/factory-health/plugins" });
    await app.close();
    expect(response.statusCode).toBe(200);
    for (const forbidden of [folder, claudeDir, "/home/operator", os.tmpdir()]) {
      expect(response.body).not.toContain(forbidden);
    }
  });
});
