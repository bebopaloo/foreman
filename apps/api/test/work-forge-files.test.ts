import { createHash } from "node:crypto";
import { schema } from "@foreman/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Each fetch runs one real `uv run` subprocess per adapter call, and a test makes
// up to five fetches of several calls. A cold `uv` start takes 0.2 to 0.5 s when
// other test runs share the machine, so such a test can pass the 5 s default of
// Vitest. 30 s is well above the worst time seen under load. A hung adapter call
// still ends at its own 20 s timeout, so a real hang still fails.
vi.setConfig({ testTimeout: 30_000 });

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
        files: { [WAIVERS]: { ref: "main", content: "# SYNTHETIC-CONTENT-MARKER\n" } },
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
        files: { [WAIVERS]: { ref: "main", content: "# x\n" } },
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
        files: { [WAIVERS]: { ref: "develop", content: "# x\n" } },
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
          files: { [WAIVERS]: { ref: "trunk", content: "# x\n" } },
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
        files: { [WAIVERS]: { ref: "main", content: "# x\n" } },
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
          [RISK_MAP]: { ref: "main", content: "# x\n" },
          [WAIVERS]: { ref: "main", content: "# y\n" },
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

const WAIVER_ONE = [
  "[[waiver]]",
  'id = "WAIVER-1"',
  'reason = "SYNTHETIC-REASON"',
  'risk = "SYNTHETIC-RISK"',
  'owner = "Operator"',
  'approved_by = "synthetic-approver"',
  "created = 2026-11-14",
  "expires = 2027-01-31",
  "",
  "[waiver.covers]",
  'kind = "check"',
  'name = "trivy"',
  "",
].join("\n");

const WAIVER_NO_EXPIRES = [
  "[[waiver]]",
  'id = "WAIVER-2"',
  'reason = "SYNTHETIC-REASON"',
  'risk = "SYNTHETIC-RISK"',
  'owner = "Operator"',
  'approved_by = "synthetic-approver"',
  "created = 2026-11-14",
  "",
  "[waiver.covers]",
  'kind = "control"',
  'id = "CTRL-PAY-03"',
  "",
].join("\n");

const ALL_MODULES = controls("risk_tiers", "control_register", "waivers", "threat_model");

describe("the module files are parsed", () => {
  it("caches the parsed fields of each module file and never the content", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(ALL_MODULES),
        files: {
          [RISK_MAP]: {
            ref: "main",
            content: '[[tier]]\nname = "authority"\npaths = ["SYNTHETIC-GLOB/**"]\n',
          },
          [CONTROL_REGISTER]: {
            ref: "main",
            content:
              '[[control]]\nid = "CTRL-PAY-03"\ntitle = "Approval"\nowner = "Operator"\nmodules = ["a/**"]\n',
          },
          [WAIVERS]: { ref: "main", content: `${WAIVER_ONE}\n${WAIVER_NO_EXPIRES}` },
          [THREAT_MODEL]: {
            ref: "main",
            content:
              "## TB-1 SYNTHETIC-NAME\n\n### TM-1 SYNTHETIC-THREAT\n- STRIDE: Spoofing\n- Controls: CTRL-PAY-03\n",
          },
        },
      }),
    });
    await env.fetchAt(T0);
    const rows = await fileRows();
    const byPath = Object.fromEntries(rows.map((row) => [row.path, row]));

    expect(byPath[RISK_MAP]).toMatchObject({
      state: "ok",
      fields: { tiers: { authority: 1, sensitive: 0, general: 0, inert: 0 }, boundaries: [] },
    });
    expect(byPath[CONTROL_REGISTER]?.fields).toMatchObject({
      controls: [{ id: "CTRL-PAY-03", owner: "Operator", modules: 1 }],
    });
    expect(byPath[WAIVERS]).toMatchObject({
      state: "ok",
      skipped: [{ position: 2, field: "expires" }],
      fields: {
        waivers: [
          {
            id: "WAIVER-1",
            owner: "Operator",
            approvedBy: "synthetic-approver",
            created: "2026-11-14",
            expires: "2027-01-31",
            covers: { kind: "check", name: "trivy" },
          },
        ],
      },
    });
    expect(byPath[THREAT_MODEL]?.fields).toEqual({
      boundaries: ["TB-1"],
      threats: [{ id: "TM-1", boundary: "TB-1", stride: ["Spoofing"], controls: ["CTRL-PAY-03"] }],
    });
    const stored = JSON.stringify(rows);
    for (const marker of [
      "SYNTHETIC-REASON",
      "SYNTHETIC-RISK",
      "SYNTHETIC-GLOB",
      "SYNTHETIC-NAME",
    ]) {
      expect(stored).not.toContain(marker);
    }
    expect(stored).not.toContain("SYNTHETIC-THREAT");
  });

  it("marks a Waiver register that is not valid TOML as not readable and keeps the other repo's Waivers", async () => {
    const env = await setup(["acme/pay", "acme/web"], {
      ...Object.fromEntries(
        Object.entries(
          fileScenario({
            configText: config(controls("waivers")),
            files: { [WAIVERS]: { ref: "main", content: "[[waiver]\nid = " } },
          }),
        ).map(([key, value]) => [`acme/pay ${key}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(
          fileScenario({
            configText: config(controls("waivers")),
            files: { [WAIVERS]: { ref: "main", content: `${WAIVER_ONE}\n${WAIVER_NO_EXPIRES}` } },
          }),
        ).map(([key, value]) => [`acme/web ${key}`, value]),
      ),
    });
    await env.fetchAt(T0);

    const pay = (await fileRows(repoId("github.com", "acme", "pay"))).find(
      (row) => row.path === WAIVERS,
    );
    expect(pay).toMatchObject({ state: "not_readable", fields: null, skipped: null });
    const web = (await fileRows(repoId("github.com", "acme", "web"))).find(
      (row) => row.path === WAIVERS,
    );
    expect(web).toMatchObject({
      state: "ok",
      skipped: [{ position: 2, field: "expires" }],
    });
    expect(web?.fields).toMatchObject({ waivers: [{ id: "WAIVER-1" }] });
  });

  it("parses a file again when its cached row has no parsed fields, although the sha is the same", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: WAIVER_ONE } },
      }),
    });
    await env.fetchAt(T0);
    await database.db
      .update(schema.workForgeFiles)
      .set({ fields: null, skipped: null })
      .where(eq(schema.workForgeFiles.path, WAIVERS));
    await env.fetchAt(minutes(5), true);
    const row = (await fileRows()).find((file) => file.path === WAIVERS);
    expect(row?.fields).toMatchObject({ waivers: [{ id: "WAIVER-1" }] });
  });

  it("does not parse a module file again when its sha is the same", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: WAIVER_ONE } },
      }),
    });
    await env.fetchAt(T0);
    await env.setForge(
      fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: "# the same sha, other content\n" } },
      }),
    );
    await env.fetchAt(minutes(5), true);
    const row = (await fileRows()).find((file) => file.path === WAIVERS);
    expect(row).toMatchObject({ state: "ok", fetchedAt: minutes(5) });
    expect(row?.fields).toMatchObject({ waivers: [{ id: "WAIVER-1" }] });
  });

  it("keeps the earlier parsed fields and skipped entries of a module file that then fails", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config(controls("waivers")),
        files: { [WAIVERS]: { ref: "main", content: `${WAIVER_ONE}\n${WAIVER_NO_EXPIRES}` } },
      }),
    });
    await env.fetchAt(T0);
    await env.setForge({
      ...fileScenario({ configText: config(controls("waivers")) }),
      [`file get ${WAIVERS} --ref main`]: { error: "HTTP 502: Bad gateway" },
    });
    await env.fetchAt(minutes(5), true);
    const row = (await fileRows()).find((file) => file.path === WAIVERS);
    expect(row).toMatchObject({
      state: "failed",
      skipped: [{ position: 2, field: "expires" }],
    });
    expect(row?.fields).toMatchObject({ waivers: [{ id: "WAIVER-1" }] });
  });
});

const RULE_STAMP = (name: string, version = "0.8.1") =>
  `<!-- factory-core ${version}: from Rule template ${name}. The team owns this file. -->`;
const ruleText = (name: string, body = "SYNTHETIC-RULE-TEXT") =>
  `${RULE_STAMP(name)}\n# ${name}\n${body}\n`;
const rulePath = (name: string) => `.claude/rules/${name}.md`;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function ruleScenario(
  configOver: Record<string, unknown>,
  rules: Record<string, string>,
  branch = "main",
  configSha?: string,
): Scenario {
  const scenario = fileScenario({
    configText: config(configOver),
    ...(configSha === undefined ? {} : { configSha }),
  });
  for (const [name, text] of Object.entries(rules)) {
    scenario[`file get ${rulePath(name)} --ref ${branch}`] = {
      ok: fileAnswer(rulePath(name), branch, text),
    };
  }
  return scenario;
}

async function ruleRows() {
  return (await fileRows()).filter((row) => row.path.startsWith(".claude/rules/"));
}

describe("the rule files", () => {
  it("reads each listed name once and caches the parsed fields, never the text", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario(
        { rules: ["coding", "react"], compliance: ["gdpr"] },
        { coding: ruleText("coding"), react: ruleText("react"), gdpr: ruleText("gdpr") },
      ),
    );
    await env.fetchAt(T0);
    const calls = forgeFileCalls(await env.adapters.calls("forge"));
    expect(calls).toEqual([
      "repo",
      `file get ${CONFIG} --ref main`,
      ...["coding", "react", "gdpr"].map((name) => `file get ${rulePath(name)} --ref main`),
    ]);

    const rows = await ruleRows();
    expect(rows.map((row) => row.path)).toEqual(["coding", "gdpr", "react"].map(rulePath));
    expect(rows.find((row) => row.path === rulePath("coding"))).toMatchObject({
      state: "ok",
      ref: "main",
      fields: {
        kind: "rule",
        stampPlugin: "factory-core",
        stampVersion: "0.8.1",
        stampName: "coding",
        textHash: sha256("# coding\nSYNTHETIC-RULE-TEXT\n"),
      },
    });
    expect(rows.find((row) => row.path === rulePath("gdpr"))?.fields).toMatchObject({
      kind: "compliance",
    });
    expect(JSON.stringify(await fileRows())).not.toContain("SYNTHETIC-RULE-TEXT");
  });

  it("runs no file get on a timer fetch within 60 minutes of the last forge file step", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario({ rules: ["coding"] }, { coding: ruleText("coding") }),
    );
    await env.fetchAt(T0);
    const before = forgeFileCalls(await env.adapters.calls("forge")).length;
    await env.fetchAt(minutes(15));
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toHaveLength(before);
    await env.fetchAt(minutes(20), true);
    expect(forgeFileCalls(await env.adapters.calls("forge")).length).toBeGreaterThan(before);
  });

  it("reads each name once when it is in both lists, as a rule", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario(
        { rules: ["coding", "coding"], compliance: ["coding"] },
        { coding: ruleText("coding") },
      ),
    );
    await env.fetchAt(T0);
    const calls = forgeFileCalls(await env.adapters.calls("forge"));
    expect(calls.filter((call) => call.includes(rulePath("coding")))).toHaveLength(1);
    expect((await ruleRows())[0]?.fields).toMatchObject({ kind: "rule" });
  });

  it("keeps the parsed fields and sets the fetch time when the sha does not change, and parses again when the kind changes", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario({ rules: ["coding"] }, { coding: ruleText("coding") }),
    );
    await env.fetchAt(T0);
    await env.fetchAt(minutes(5), true);
    const [row] = await ruleRows();
    expect(row?.fetchedAt).toEqual(minutes(5));
    expect(row?.fields).toMatchObject({ kind: "rule" });

    await env.setForge(
      ruleScenario({ compliance: ["coding"] }, { coding: ruleText("coding") }, "main", SHA_B),
    );
    await env.fetchAt(minutes(10), true);
    expect((await ruleRows())[0]?.fields).toMatchObject({ kind: "compliance" });
  });

  it("finds the stamp after the front matter and counts only a stamp of the rule name", async () => {
    const framed = `---\npaths: a\n---\n${RULE_STAMP("react")}\n# react\n`;
    const env = await setup(
      ["acme/app"],
      ruleScenario(
        { rules: ["react", "coding"] },
        { react: framed, coding: `${RULE_STAMP("security")}\n# coding\n` },
      ),
    );
    await env.fetchAt(T0);
    const rows = await ruleRows();
    expect(rows.find((row) => row.path === rulePath("react"))?.fields).toMatchObject({
      stampName: "react",
      textHash: sha256("---\npaths: a\n---\n# react\n"),
    });
    expect(rows.find((row) => row.path === rulePath("coding"))?.fields).toMatchObject({
      stampPlugin: null,
      textHash: sha256(`${RULE_STAMP("security")}\n# coding\n`),
    });
  });

  it("records a missing rule file and a missing ref, and the fetch stays ok", async () => {
    const env = await setup(["acme/app"], {
      ...ruleScenario({ rules: ["fastify-api", "coding"] }, {}),
      [`file get ${rulePath("fastify-api")} --ref main`]: {
        error: `file not found: ${rulePath("fastify-api")} at main`,
      },
      [`file get ${rulePath("coding")} --ref main`]: { error: "ref not found: main" },
    });
    await env.fetchAt(T0);
    const rows = await ruleRows();
    expect(rows.map((row) => [row.path, row.state])).toEqual([
      [rulePath("coding"), "missing_ref"],
      [rulePath("fastify-api"), "missing_file"],
    ]);
    expect(await repoRow()).toMatchObject({ forgeState: "ok" });
  });

  it("keeps the earlier hash and shows no drift state for a large, invalid or failed rule file", async () => {
    const names = ["big", "bad", "boom"];
    const first = ruleScenario(
      { rules: names },
      Object.fromEntries(names.map((name) => [name, ruleText(name)])),
    );
    const env = await setup(["acme/app"], first);
    await env.fetchAt(T0);
    const earlier = Object.fromEntries((await ruleRows()).map((row) => [row.path, row.fields]));

    await env.setForge({
      ...ruleScenario({ rules: names }, {}),
      [`file get ${rulePath("big")} --ref main`]: {
        ok: { ...fileAnswer(rulePath("big"), "main", "x"), size: 2_000_000 },
      },
      [`file get ${rulePath("bad")} --ref main`]: { ok: { path: rulePath("bad") } },
      [`file get ${rulePath("boom")} --ref main`]: { error: "HTTP 500 server error" },
    });
    await env.fetchAt(minutes(5), true);
    const rows = await ruleRows();
    expect(rows.map((row) => [row.path, row.state, row.errorClass])).toEqual([
      [rulePath("bad"), "failed", "invalid_output"],
      [rulePath("big"), "failed", "too_large"],
      [rulePath("boom"), "failed", "other"],
    ]);
    for (const row of rows) expect(row.fields).toEqual(earlier[row.path]);
    expect(await repoRow()).toMatchObject({ forgeState: "partial" });
  });

  it("marks no rule file as read for a repo with no factory config, and keeps the earlier rule rows", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario({ rules: ["coding"] }, { coding: ruleText("coding") }),
    );
    await env.fetchAt(T0);
    await env.setForge({
      repo: { ok: repoInfo("main") },
      [`file get ${CONFIG} --ref main`]: { error: `file not found: ${CONFIG} at main` },
    });
    await env.fetchAt(minutes(5), true);
    const calls = forgeFileCalls(await env.adapters.calls("forge"));
    expect(calls.slice(-2)).toEqual(["repo", `file get ${CONFIG} --ref main`]);
    expect((await ruleRows()).map((row) => row.state)).toEqual(["ok"]);
  });

  it.each([
    ["is not valid JSON", "not json"],
    ["has rules that is not a list of names", config({ rules: "coding", compliance: ["gdpr"] })],
    ["has a rule name with a capital", config({ rules: ["Coding"] })],
  ])(
    "reads no rule file when the factory config %s, and keeps the earlier rule rows",
    async (_name, text) => {
      const env = await setup(
        ["acme/app"],
        ruleScenario({ rules: ["coding"] }, { coding: ruleText("coding") }),
      );
      await env.fetchAt(T0);
      const before = forgeFileCalls(await env.adapters.calls("forge")).length;
      await env.setForge(fileScenario({ configText: text, configSha: SHA_B }));
      await env.fetchAt(minutes(5), true);
      const after = forgeFileCalls(await env.adapters.calls("forge")).slice(before);
      expect(after.some((call) => call.includes(".claude/rules/"))).toBe(false);
      expect((await ruleRows()).map((row) => row.path)).toEqual([rulePath("coding")]);
    },
  );

  it("still reads the module files when only a rule key is not valid", async () => {
    const env = await setup(["acme/app"], {
      ...fileScenario({
        configText: config({ rules: "coding", ...controls("waivers") }),
        files: { [WAIVERS]: { ref: "main", content: "" } },
      }),
    });
    await env.fetchAt(T0);
    const rows = await fileRows();
    expect(rows.find((row) => row.path === WAIVERS)?.state).toBe("ok");
    expect(await ruleRows()).toEqual([]);
  });

  it("reads the config at the default branch and the rule files at main_branch", async () => {
    const env = await setup(["acme/app"], {
      repo: { ok: repoInfo("trunk") },
      [`file get ${CONFIG} --ref trunk`]: {
        ok: fileAnswer(CONFIG, "trunk", config({ main_branch: "main", rules: ["coding"] })),
      },
      [`file get ${rulePath("coding")} --ref main`]: {
        ok: fileAnswer(rulePath("coding"), "main", ruleText("coding")),
      },
    });
    await env.fetchAt(T0);
    expect(forgeFileCalls(await env.adapters.calls("forge"))).toEqual([
      "repo",
      `file get ${CONFIG} --ref trunk`,
      `file get ${rulePath("coding")} --ref main`,
    ]);
    expect((await ruleRows())[0]).toMatchObject({ state: "ok", ref: "main" });
  });

  it("removes the row of a rule that leaves the list", async () => {
    const env = await setup(
      ["acme/app"],
      ruleScenario(
        { rules: ["coding", "react"] },
        { coding: ruleText("coding"), react: ruleText("react") },
      ),
    );
    await env.fetchAt(T0);
    expect(await ruleRows()).toHaveLength(2);
    await env.setForge(
      ruleScenario({ rules: ["coding"] }, { coding: ruleText("coding") }, "main", SHA_B),
    );
    await env.fetchAt(minutes(5), true);
    expect((await ruleRows()).map((row) => row.path)).toEqual([rulePath("coding")]);
  });

  it("logs the repo ID, the file names, the counts and the error classes, and no text or hash", async () => {
    const env = await setup(["acme/app"], {
      ...ruleScenario({ rules: ["coding", "react"] }, { coding: ruleText("coding") }),
      [`file get ${rulePath("react")} --ref main`]: { error: "HTTP 500 secret-adapter-output" },
    });
    const lines: string[] = [];
    const claudeDir = env.claudeDir;
    await runFetch({
      db: database.db,
      claudeDir,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      now: () => T0,
      tokensFile: await writeTokens(claudeDir, { "github.com/acme": TOKEN }),
      log: { info: (line) => lines.push(line), warn: (line) => lines.push(line) },
    });
    const text = lines.join("\n");
    expect(text).toContain(APP);
    expect(text).toContain(rulePath("react"));
    expect(text).toMatch(/listed=2/);
    expect(text).toContain("error=other");
    for (const forbidden of [
      "SYNTHETIC-RULE-TEXT",
      sha256("# coding\nSYNTHETIC-RULE-TEXT\n"),
      "secret-adapter-output",
      TOKEN,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
