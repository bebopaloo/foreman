import { schema } from "@foreman/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readControlModules } from "../src/controls/modules.ts";
import { runReindex } from "../src/reindex.ts";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
  fileAnswer,
  forgeScenario,
  installAdapters,
  repoInfo,
  TOKEN,
  trackerScenario,
  writeTokens,
  type Scenario,
} from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases, work_release_records, work_forge_files, work_fetch_runs`,
  );
});

const CONFIG = ".claude/factory.json";
const RISK_MAP = "_context/controls/risk-map.toml";
const CONTROL_REGISTER = "_context/controls/controls.toml";
const WAIVERS = "_context/controls/waivers.toml";
const THREAT_MODEL = "_context/threat-model.md";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const T0 = new Date("2026-03-01T10:00:00Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

function config(over: Record<string, unknown>): string {
  return JSON.stringify(over);
}

function controls(...modules: string[]) {
  return { controls: { profile: "custom", modules } };
}

/** The scenario keys of a repo that has a default branch, a repo config and module files. */
function fileScenario(options: {
  defaultBranch?: string;
  configText?: string;
  configSha?: string;
  files?: Record<string, { ref: string; content: string }>;
}): Scenario {
  const branch = options.defaultBranch ?? "main";
  const scenario: Scenario = { repo: { ok: repoInfo(branch) } };
  if (options.configText !== undefined) {
    scenario[`file get ${CONFIG} --ref ${branch}`] = {
      ok: fileAnswer(CONFIG, branch, options.configText, options.configSha),
    };
  }
  for (const [path, file] of Object.entries(options.files ?? {})) {
    scenario[`file get ${path} --ref ${file.ref}`] = {
      ok: fileAnswer(path, file.ref, file.content),
    };
  }
  return scenario;
}

async function setup(repos: string[] = ["acme/app"], forgeExtra: Scenario = {}) {
  const claudeDir = await makeClaudeDir({
    repos: repos.map((name) => entry(name, "acme", adapterEntry)),
  });
  const adapters = await installAdapters(claudeDir);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
  await adapters.setScenario("tracker", trackerScenario([], [], []));
  const setForge = (extra: Scenario) =>
    adapters.setScenario("forge", { ...forgeScenario([], []), ...extra });
  await setForge(forgeExtra);
  const fetchAt = (now: Date, refresh = false) =>
    runFetch({
      db: database.db,
      claudeDir,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      now: () => now,
      tokensFile,
      refresh,
    });
  return { claudeDir, adapters, setForge, fetchAt };
}

const APP = repoId("github.com", "acme", "app");

async function fileRows(repo = APP) {
  return database.db
    .select()
    .from(schema.workForgeFiles)
    .where(eq(schema.workForgeFiles.repoId, repo))
    .orderBy(asc(schema.workForgeFiles.path));
}

async function repoRow(repo = APP) {
  const [row] = await database.db
    .select()
    .from(schema.workRepos)
    .where(eq(schema.workRepos.id, repo));
  return row;
}

function forgeFileCalls(calls: string[]) {
  return calls.filter((call) => call === "repo" || call.startsWith("file get"));
}

describe("the Control modules from the repo config", () => {
  it("caches the profile and the module names, and the profile none for a config with no controls key", async () => {
    const regulated = [
      "risk_tiers",
      "waivers",
      "control_register",
      "threat_model",
      "control_events",
    ];
    const env = await setup(["acme/pay", "acme/web"], {
      ...Object.fromEntries(
        Object.entries(
          fileScenario({
            configText: config({ controls: { profile: "regulated", modules: regulated } }),
          }),
        ).map(([key, value]) => [`acme/pay ${key}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(fileScenario({ configText: config({ main_branch: "main" }) })).map(
          ([key, value]) => [`acme/web ${key}`, value],
        ),
      ),
    });
    await env.fetchAt(T0);

    const rows = await readControlModules(database.db);
    const pay = rows.find((row) => row.repoId === repoId("github.com", "acme", "pay"));
    const web = rows.find((row) => row.repoId === repoId("github.com", "acme", "web"));
    expect(pay).toMatchObject({
      profile: "regulated",
      modules: regulated,
      controlEvents: true,
      defaultBranch: "main",
      fileBranch: "main",
      configState: "ok",
    });
    expect(web).toMatchObject({ profile: "none", modules: [], controlEvents: false });
  });

  it("keeps parsed fields only, never the content of the file", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config({ ...controls("waivers"), secret_note: "SYNTHETIC-CONTENT-MARKER" }),
        files: { [WAIVERS]: { ref: "main", content: "SYNTHETIC-CONTENT-MARKER" } },
      }),
    });
    await env.fetchAt(T0);
    const rows = await fileRows();
    expect(rows.find((row) => row.path === WAIVERS)).toMatchObject({ state: "ok", sha: SHA_A });
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC-CONTENT-MARKER");
  });
});

describe("a controls key that is not valid", () => {
  it("caches the state, reads no other file and keeps the earlier rows of the module files", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: "x" } },
      }),
    });
    await env.fetchAt(T0);
    await env.adapters.clearCalls();
    await env.setForge(
      fileScenario({
        configText: config({ controls: { profile: "custom", modules: "waivers" } }),
        configSha: SHA_B,
      }),
    );
    await env.fetchAt(minutes(5), true);

    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([
      "repo",
      `file get ${CONFIG} --ref main`,
    ]);
    const rows = await fileRows();
    expect(rows.find((row) => row.path === WAIVERS)).toMatchObject({ state: "ok", sha: SHA_A });
    const [module] = await readControlModules(database.db);
    expect(module).toMatchObject({ profile: "none", modules: [] });
    expect(module?.config?.controls).toEqual({ state: "not_valid" });
  });
});

describe("no repo config", () => {
  it("records the missing file and the missing ref, and every other file as module off", async () => {
    const env = await setup(["acme/app", "acme/lib"], {
      "acme/app repo": { ok: repoInfo("main") },
      [`acme/app file get ${CONFIG} --ref main`]: {
        error: `file not found: ${CONFIG} at main`,
      },
      "acme/lib repo": { ok: repoInfo("main") },
      [`acme/lib file get ${CONFIG} --ref main`]: { error: "ref not found: main" },
    });
    const result = await env.fetchAt(T0);
    expect(result.repos).toBe(2);

    const app = await fileRows(APP);
    expect(Object.fromEntries(app.map((row) => [row.path, row.state]))).toEqual({
      [CONFIG]: "missing_file",
      [RISK_MAP]: "module_off",
      [CONTROL_REGISTER]: "module_off",
      [WAIVERS]: "module_off",
      [THREAT_MODEL]: "module_off",
    });
    const lib = await fileRows(repoId("github.com", "acme", "lib"));
    expect(lib.find((row) => row.path === CONFIG)?.state).toBe("missing_ref");

    const [forgeState] = await database.db
      .select({ state: schema.workRepos.forgeState })
      .from(schema.workRepos)
      .where(eq(schema.workRepos.id, APP));
    expect(forgeState?.state).toBe("ok");
  });
});

describe("the branch of the forge files", () => {
  it("reads the repo config at the default branch and the other files at main_branch", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        defaultBranch: "trunk",
        configText: config({ main_branch: "develop", ...controls("waivers") }),
        files: { [WAIVERS]: { ref: "develop", content: "x" } },
      }),
    });
    await env.fetchAt(T0);
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([
      "repo",
      `file get ${CONFIG} --ref trunk`,
      `file get ${WAIVERS} --ref develop`,
    ]);
    expect(await repoRow()).toMatchObject({ defaultBranch: "trunk", fileBranch: "develop" });
    const [module] = await readControlModules(database.db);
    expect(module?.config?.mainBranch).toBe("develop");
  });

  it.each([["-x"], [null]])(
    "reads the other files at the default branch for main_branch %j",
    async (main) => {
      const env = await setup(["acme/app"], {
        ...fileScenario({
          defaultBranch: "trunk",
          configText: config({
            ...(main === null ? {} : { main_branch: main }),
            ...controls("waivers"),
          }),
          files: { [WAIVERS]: { ref: "trunk", content: "x" } },
        }),
      });
      await env.fetchAt(T0);
      expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([
        "repo",
        `file get ${CONFIG} --ref trunk`,
        `file get ${WAIVERS} --ref trunk`,
      ]);
      expect(await repoRow()).toMatchObject({ fileBranch: "trunk" });
    },
  );

  it.each([[""], ["-x"]])("records no default branch for %j and reads no file", async (branch) => {
    const env = await setup(["acme/app"], { repo: { ok: repoInfo(branch) } });
    await env.fetchAt(T0);
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual(["repo"]);
    expect(await repoRow()).toMatchObject({
      repoState: "no_default_branch",
      defaultBranch: null,
      fileBranch: null,
    });
    expect(await fileRows()).toEqual([]);
  });

  it("records the error class of a failed repo call and keeps every cached file row", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: "x" } },
      }),
    });
    await env.fetchAt(T0);
    await env.setForge({ repo: { error: "HTTP 401: Bad credentials" } });
    await env.fetchAt(minutes(1), true);
    expect(await repoRow()).toMatchObject({
      repoState: "failed",
      repoErrorClass: "auth",
      forgeState: "partial",
    });
    const states = Object.fromEntries((await fileRows()).map((row) => [row.path, row.state]));
    expect(states).toMatchObject({ [CONFIG]: "ok", [WAIVERS]: "ok" });
    expect(await fileRows()).toHaveLength(5);
  });
});

describe("files only for modules that are on", () => {
  it("reads the config and the files of the modules that are on, and marks the others module off", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("risk_tiers", "waivers")),
        files: {
          [RISK_MAP]: { ref: "main", content: "x" },
          [WAIVERS]: { ref: "main", content: "y" },
        },
      }),
    });
    await env.fetchAt(T0);
    expect(forgeFileCalls(await env.adapters.calls("forge")).sort()).toEqual(
      [
        "repo",
        `file get ${CONFIG} --ref main`,
        `file get ${RISK_MAP} --ref main`,
        `file get ${WAIVERS} --ref main`,
      ].sort(),
    );
    const states = Object.fromEntries((await fileRows()).map((row) => [row.path, row.state]));
    expect(states).toEqual({
      [CONFIG]: "ok",
      [RISK_MAP]: "ok",
      [CONTROL_REGISTER]: "module_off",
      [WAIVERS]: "ok",
      [THREAT_MODEL]: "module_off",
    });
  });
});

describe("when the forge file step runs", () => {
  it("runs on the first fetch, skips the timer fetch, then runs on a refresh, after 60 minutes and on a full fetch", async () => {
    const env = await setup(["acme/app"], fileScenario({ configText: config({}) }));
    // The first fetch has no earlier forge file step.
    await env.fetchAt(T0);
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([
      "repo",
      `file get ${CONFIG} --ref main`,
    ]);

    // An incremental fetch from the timer, 20 minutes after the last step.
    await env.adapters.clearCalls();
    await env.fetchAt(minutes(20));
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([]);

    // A fetch from a refresh request.
    await env.fetchAt(minutes(21), true);
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toHaveLength(2);

    // 61 minutes after the last step, a timer fetch.
    await env.adapters.clearCalls();
    await env.fetchAt(minutes(21 + 61));
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toHaveLength(2);

    // A full fetch, 10 minutes later.
    await env.adapters.clearCalls();
    await database.db.delete(schema.workFetchRuns).where(eq(schema.workFetchRuns.kind, "full"));
    await env.fetchAt(minutes(21 + 61 + 10));
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toHaveLength(2);
  });

  it("records the end time of the step", async () => {
    const env = await setup(["acme/app"], fileScenario({ configText: config({}) }));
    await env.fetchAt(T0);
    expect((await repoRow())?.forgeFilesEndedAt).toEqual(T0);
  });
});

describe("a file that did not change", () => {
  it("does not parse the file again and sets its fetch time", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(CONFIG, "main", config({ main_branch: "develop" }), SHA_A),
      },
    });
    await env.fetchAt(T0);
    expect((await fileRows())[0]?.fields).toMatchObject({ mainBranch: "develop" });

    // The same sha with other content: a parser that ran again would show the new content.
    await env.setForge({
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(CONFIG, "main", config({ main_branch: "other" }), SHA_A),
      },
    });
    await env.fetchAt(minutes(5), true);
    const [row] = await fileRows();
    expect(row?.fields).toMatchObject({ mainBranch: "develop" });
    expect(row?.fetchedAt).toEqual(minutes(5));
  });

  it("parses the file again when the sha changes", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(CONFIG, "main", config({ main_branch: "develop" }), SHA_A),
      },
    });
    await env.fetchAt(T0);
    await env.setForge({
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(CONFIG, "main", config({ main_branch: "other" }), SHA_B),
      },
    });
    await env.fetchAt(minutes(5), true);
    expect((await fileRows())[0]?.fields).toMatchObject({ mainBranch: "other" });
  });
});

describe("a file that the adapter refuses", () => {
  it("keeps the earlier parsed data, records the error class and makes the forge state partial", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(CONFIG, "main", config({ main_branch: "develop" }), SHA_A),
      },
    });
    await env.fetchAt(T0);
    await env.setForge({
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        error: `${CONFIG} is 2000000 bytes; file get reads at most 1048576 bytes`,
      },
    });
    await env.fetchAt(minutes(5), true);
    const [row] = await fileRows();
    expect(row).toMatchObject({ state: "failed", errorClass: "other", sha: SHA_A });
    expect(row?.fields).toMatchObject({ mainBranch: "develop" });
    expect(await repoRow()).toMatchObject({ forgeState: "partial", forgeErrorClass: "other" });
  });

  it("does not store an output with a size over the limit, and keeps the earlier data", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: { ...fileAnswer(CONFIG, "main", "SYNTHETIC-CONTENT-MARKER"), size: 2_000_000 },
      },
    });
    await env.fetchAt(T0);
    const rows = await fileRows();
    expect(rows[0]).toMatchObject({ state: "failed", errorClass: "invalid_output", fields: null });
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC-CONTENT-MARKER");
    expect(await repoRow()).toMatchObject({ forgeState: "partial" });
  });

  it("does not store an output whose path differs from the command", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo() },
      [`file get ${CONFIG} --ref main`]: {
        ok: fileAnswer(WAIVERS, "main", "SYNTHETIC-CONTENT-MARKER"),
      },
    });
    await env.fetchAt(T0);
    const rows = await fileRows();
    expect(rows[0]).toMatchObject({ state: "failed", errorClass: "invalid_output" });
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC-CONTENT-MARKER");
  });

  it("marks a config that is not a JSON object as not readable, with no fields", async () => {
    const env = await setup(["acme/app"], fileScenario({ configText: "[1, 2]" }));
    await env.fetchAt(T0);
    expect((await fileRows())[0]).toMatchObject({ state: "not_readable", fields: null });
    expect(await repoRow()).toMatchObject({ forgeState: "ok" });
  });
});

describe("the reindex", () => {
  it("empties the forge files with the other work tables", async () => {
    const env = await setup(["acme/app"], fileScenario({ configText: config({}) }));
    await env.fetchAt(T0);
    expect(await fileRows()).not.toHaveLength(0);
    await runReindex({
      db: database.db,
      claudeDir: env.claudeDir,
      dataDir: env.claudeDir,
      log: { info: () => undefined, warn: () => undefined },
    });
    expect(await database.db.select().from(schema.workForgeFiles)).toEqual([]);
  });
});
