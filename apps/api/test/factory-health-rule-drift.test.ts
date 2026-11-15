import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@foreman/db";
import { RuleDriftResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { parseRuleFile, type RuleKind } from "../src/controls/files.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import { writeTokens } from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table work_repos, work_forge_files`);
});

const PAY = repoId("github.com", "acme", "pay");
const WEB = repoId("github.com", "acme", "web");
const GLOBEX = repoId("github.com", "globex", "api");
const T0 = new Date("2026-11-14T10:00:00Z");
const SHA = "abcdef0123456789".repeat(2) + "abcdef01";
const CONFIG = ".claude/factory.json";
const TOKENS = { "github.com/acme": "t", "github.com/globex": "t" };
const HOME = "/home/operator/.claude/plugins/cache/demo-market";

type Templates = Partial<Record<RuleKind, Record<string, string>>>;

interface PluginSpec {
  version: string;
  templates?: Templates;
  /** Older versions kept in the plugin cache, by version. */
  cached?: Record<string, Templates>;
}

async function writeTemplates(base: string, templates: Templates | undefined) {
  for (const [kind, files] of Object.entries(templates ?? {})) {
    const folder = path.join(base, "templates", "rules", kind === "compliance" ? "compliance" : "");
    await mkdir(folder, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      await writeFile(path.join(folder, `${name}.md`), text);
    }
  }
}

async function writePlugins(claudeDir: string, plugins: Record<string, PluginSpec>) {
  const folder = path.join(claudeDir, "plugins");
  await mkdir(folder, { recursive: true });
  const installed: Record<string, unknown[]> = {};
  for (const [name, spec] of Object.entries(plugins)) {
    installed[`${name}@demo-market`] = [
      {
        scope: "user",
        installPath: `${HOME}/${name}/${spec.version}`,
        version: spec.version,
        lastUpdated: "2026-11-01T09:00:00.000Z",
      },
    ];
    const cache = path.join(folder, "cache", "demo-market", name);
    await writeTemplates(path.join(cache, spec.version), spec.templates);
    for (const [version, templates] of Object.entries(spec.cached ?? {})) {
      await writeTemplates(path.join(cache, version), templates);
    }
  }
  await writeFile(
    path.join(folder, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: installed }),
  );
}

interface Setup {
  plugins?: Record<string, PluginSpec>;
  repos?: unknown[];
  tokens?: Record<string, string>;
}

async function appFor({ plugins, repos, tokens = TOKENS }: Setup = {}) {
  const claudeDir = await makeClaudeDir({
    repos: repos ?? [
      entry("acme/pay", "acme"),
      entry("acme/web", "acme"),
      entry("globex/api", "globex"),
    ],
  });
  if (plugins !== undefined) await writePlugins(claudeDir, plugins);
  const tokensFile = await writeTokens(claudeDir, tokens);
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  const app = await buildApp({ config, db: database.db, logger: false });
  return { app, claudeDir };
}

type App = Awaited<ReturnType<typeof appFor>>["app"];

async function view(app: App, query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/api/factory-health/rule-drift${query}`,
  });
  expect(response.statusCode).toBe(200);
  return RuleDriftResponse.parse(response.json<unknown>());
}

async function seedRepo(
  id: string,
  owner: string,
  name: string,
  over: Partial<typeof schema.workRepos.$inferInsert> = {},
) {
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    forgeState: "connected",
    trackerState: "connected",
    lastGoodFetchAt: T0,
    defaultBranch: "main",
    fileBranch: "main",
    repoState: "ok",
    ...over,
  });
}

async function seedFile(
  repo: string,
  filePath: string,
  fields: unknown,
  over: Partial<typeof schema.workForgeFiles.$inferInsert> = {},
) {
  await database.db.insert(schema.workForgeFiles).values({
    repoId: repo,
    path: filePath,
    ref: "main",
    sha: SHA,
    size: 10,
    fetchedAt: T0,
    state: "ok",
    skipped: [],
    fields,
    ...over,
  });
}

interface ConfigSetup {
  rules?: string[];
  compliance?: string[];
  stackPack?: { name: string; version: string } | null;
  mainBranch?: string | null;
}

async function seedConfig(repo: string, setup: ConfigSetup = {}) {
  await seedFile(repo, CONFIG, {
    mainBranch: setup.mainBranch ?? null,
    rules: { state: "ok", value: setup.rules ?? [] },
    compliance: { state: "ok", value: setup.compliance ?? [] },
    stackPack: { state: "ok", value: setup.stackPack ?? null },
    factoryCoreVersion: { state: "ok", value: "0.30.0" },
    controls: { state: "none" },
    releases: null,
  });
}

function stamp(plugin: string, version: string, name: string): string {
  return `<!-- ${plugin} ${version}: from Rule template ${name}. The team owns this file. -->`;
}

/** Seeds the cache row of a rule file with the text, as the forge file step parses it. */
async function seedRule(
  repo: string,
  name: string,
  text: string,
  kind: RuleKind = "rule",
  over: Partial<typeof schema.workForgeFiles.$inferInsert> = {},
) {
  await seedFile(repo, `.claude/rules/${name}.md`, parseRuleFile(name, kind, text), over);
}

const CODING = "# Coding\n\nValidate input.\n";
const CORE: PluginSpec = { version: "0.30.0", templates: { rule: { coding: CODING } } };

function ruleOf(body: RuleDriftResponse, repo: string, name: string) {
  const found = body.items.find((item) => item.repoId === repo)?.rules.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no rule ${name}`);
  return found;
}

describe("GET /api/factory-health/rule-drift", () => {
  it("shows rules that equal the stamped templates as current", async () => {
    const { app } = await appFor({
      plugins: {
        "factory-core": {
          version: "0.30.0",
          templates: { rule: { coding: CODING }, compliance: { gdpr: "# GDPR\n" } },
        },
        "stack-ts": { version: "0.10.0", templates: { rule: { typescript: "# TS\n" } } },
      },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, {
      rules: ["coding", "typescript"],
      compliance: ["gdpr"],
      stackPack: { name: "stack-ts", version: "0.10.0" },
    });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.30.0", "coding")}\n${CODING}`);
    await seedRule(PAY, "typescript", `${stamp("stack-ts", "0.10.0", "typescript")}\n# TS\n`);
    await seedRule(
      PAY,
      "gdpr",
      `${stamp("factory-core", "0.30.0", "gdpr")}\n# GDPR\n`,
      "compliance",
    );

    const body = await view(app, `?repo=${PAY}`);
    const repo = body.items[0];
    expect(repo?.summary.current).toBe(3);
    expect(repo?.rules.map((r) => r.state)).toEqual(["current", "current", "current"]);
    expect(repo?.stackPackInstalled).toBe(true);
    expect(repo?.installedFactoryCoreVersion).toBe("0.30.0");
    expect(ruleOf(body, PAY, "typescript").sourcePlugin).toBe("stack-ts");
  });

  it("shows an older stamp with the same text as current with its stamp version", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.8.1", "coding")}\n${CODING}`);

    const rule = ruleOf(await view(app), PAY, "coding");
    expect(rule.state).toBe("current");
    expect(rule.stampVersion).toBe("0.8.1");
  });

  it("shows a rule that equals the template at its stamp version as behind", async () => {
    const { app } = await appFor({
      plugins: {
        "factory-core": { ...CORE, cached: { "0.8.1": { rule: { coding: "# Old coding\n" } } } },
      },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.8.1", "coding")}\n# Old coding\n`);

    const body = await view(app);
    expect(ruleOf(body, PAY, "coding").state).toBe("behind");
    expect(body.items.find((item) => item.repoId === PAY)?.summary.behind).toBe(1);
  });

  it("shows a rule that differs from both templates as edited by the team", async () => {
    const { app } = await appFor({
      plugins: {
        "factory-core": { ...CORE, cached: { "0.8.1": { rule: { coding: "# Old coding\n" } } } },
      },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.8.1", "coding")}\n# Our coding\n`);

    expect(ruleOf(await view(app), PAY, "coding").state).toBe("edited_by_team");
  });

  it("shows differs when the cache has no template at the stamp version", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.6.0", "coding")}\n# Other\n`);

    expect(ruleOf(await view(app), PAY, "coding").state).toBe("differs");
  });

  it("compares the whole text when the rule has no stamp or a stamp for another template", async () => {
    const { app } = await appFor({
      plugins: {
        "factory-core": {
          version: "0.30.0",
          templates: { rule: { coding: CODING, testing: "# Testing\n" } },
        },
      },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding", "testing"] });
    await seedRule(PAY, "coding", CODING);
    await seedRule(PAY, "testing", `${stamp("factory-core", "0.30.0", "security")}\n# Testing\n`);

    const body = await view(app);
    expect(ruleOf(body, PAY, "coding")).toMatchObject({ state: "current", stampPlugin: null });
    expect(ruleOf(body, PAY, "testing").state).toBe("differs");
  });

  it("finds the stamp after the front matter", async () => {
    const react = "---\npaths: src\n---\n# React\n";
    const { app } = await appFor({
      plugins: { "factory-core": { version: "0.30.0", templates: { rule: { react } } } },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["react"] });
    const stamped = `---\npaths: src\n---\n${stamp("factory-core", "0.30.0", "react")}\n# React\n`;
    await seedRule(PAY, "react", stamped);

    const rule = ruleOf(await view(app), PAY, "react");
    expect(rule).toMatchObject({ state: "current", stampPlugin: "factory-core" });
  });

  it("shows a listed rule that is missing, and a missing branch", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding", "security"] });
    await seedFile(PAY, ".claude/rules/coding.md", null, {
      state: "missing_file",
      ref: null,
      sha: null,
      size: null,
    });
    await seedFile(PAY, ".claude/rules/security.md", null, {
      state: "missing_ref",
      ref: null,
      sha: null,
      size: null,
    });

    const body = await view(app);
    expect(ruleOf(body, PAY, "coding").state).toBe("missing_file");
    expect(ruleOf(body, PAY, "security").state).toBe("missing_ref");
  });

  it("shows no template, and a Stack pack that is not installed", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["python"], stackPack: { name: "stack-py", version: "0.1.0" } });
    await seedRule(PAY, "python", `${stamp("stack-py", "0.1.0", "python")}\n# Python\n`);

    const body = await view(app);
    expect(ruleOf(body, PAY, "python")).toMatchObject({ state: "no_template", sourcePlugin: null });
    expect(body.items[0]?.stackPackInstalled).toBe(false);
  });

  it("shows a template name in two plugins as not unique", async () => {
    const { app } = await appFor({
      plugins: {
        "factory-core": { version: "0.30.0", templates: { rule: { testing: "# A\n" } } },
        "stack-ts": { version: "0.10.0", templates: { rule: { testing: "# B\n" } } },
      },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, {
      rules: ["testing"],
      stackPack: { name: "stack-ts", version: "0.10.0" },
    });
    await seedRule(PAY, "testing", "# A\n");

    expect(ruleOf(await view(app), PAY, "testing").state).toBe("not_unique");
  });

  it("uses the template that is installed now, with no fetch between", async () => {
    const { app, claudeDir } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", CODING);
    expect(ruleOf(await view(app), PAY, "coding").state).toBe("current");

    await writeFile(
      path.join(
        claudeDir,
        "plugins/cache/demo-market/factory-core/0.30.0/templates/rules/coding.md",
      ),
      "# Coding changed\n",
    );
    expect(ruleOf(await view(app), PAY, "coding").state).toBe("differs");
  });

  it("never shows a drift state for a rule file whose last read failed", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding", "security"] });
    await seedRule(PAY, "coding", CODING, "rule", {
      state: "failed",
      errorClass: "invalid_output",
    });
    await seedRule(PAY, "security", CODING, "rule", { state: "failed", errorClass: "other" });

    const body = await view(app);
    expect(ruleOf(body, PAY, "coding")).toMatchObject({
      state: "failed",
      errorState: "invalid adapter output",
    });
    expect(ruleOf(body, PAY, "security").errorState).toBe("adapter error");
  });

  it("shows a rule file that is too large as such, with no drift state", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", CODING, "rule", { state: "failed", errorClass: "too_large" });

    expect(ruleOf(await view(app), PAY, "coding")).toMatchObject({
      state: "failed",
      errorState: "file too large",
    });
  });

  it("shows no rules for a repo that is not set up, or whose config is not readable", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");
    await seedFile(PAY, CONFIG, null, { state: "missing_file", ref: null, sha: null, size: null });
    await seedFile(WEB, CONFIG, {
      mainBranch: null,
      rules: { state: "not_valid" },
      compliance: { state: "ok", value: [] },
      stackPack: { state: "ok", value: null },
      factoryCoreVersion: { state: "ok", value: null },
      controls: { state: "none" },
      releases: null,
    });

    const body = await view(app);
    const states = Object.fromEntries(body.items.map((item) => [item.repoId, item.configState]));
    expect(states[PAY]).toBe("not_set_up");
    expect(states[WEB]).toBe("not_readable");
    expect(body.items.every((item) => item.rules.length === 0)).toBe(true);
  });

  it("shows the main branch of the factory config when it is not the default branch", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay", { defaultBranch: "trunk", fileBranch: "main" });
    await seedConfig(PAY, { mainBranch: "main" });

    const repo = (await view(app)).items.find((item) => item.repoId === PAY);
    expect(repo).toMatchObject({ defaultBranch: "trunk", fileBranch: "main", mainBranch: "main" });
  });

  it("shows only the repos of the client in a client scope", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");
    await seedRepo(GLOBEX, "globex", "api");

    const body = await view(app, "?client=acme");
    expect(body.items.map((item) => item.repo)).toEqual(["acme/pay", "acme/web"]);
  });

  it("refuses a repo outside the client, an unknown client and an unknown query key", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    for (const query of [`?client=acme&repo=${GLOBEX}`, "?client=nobody", "?x=1", "?repo=abc"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/factory-health/rule-drift${query}`,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("filters to one repo", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");

    const body = await view(app, `?repo=${WEB}`);
    expect(body.items.map((item) => item.repoId)).toEqual([WEB]);
  });

  it("pages the repos", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");

    const first = await view(app, "?client=acme&limit=1");
    expect(first.items.map((item) => item.repo)).toEqual(["acme/pay"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await view(
      app,
      `?client=acme&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );
    expect(second.items.map((item) => item.repo)).toEqual(["acme/web"]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists a repo with no token as not connected, with no rules and one incomplete repo", async () => {
    const { app } = await appFor({
      plugins: { "factory-core": CORE },
      tokens: { "github.com/acme": "t" },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", CODING);
    await seedRepo(GLOBEX, "globex", "api");
    await seedConfig(GLOBEX, { rules: ["coding"] });
    await seedRule(GLOBEX, "coding", CODING);
    await seedRepo(WEB, "acme", "web");

    const body = await view(app);
    expect(body.state).toBe("ok");
    expect(body.complete.incompleteRepos).toBe(1);
    const globex = body.items.find((item) => item.repoId === GLOBEX);
    expect(globex).toMatchObject({ connection: "not connected: no token", rules: [] });
  });

  it("shows not connected when no repo in scope has cache rows", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE }, tokens: {} });
    await seedRepo(PAY, "acme", "pay");

    const body = await view(app);
    expect(body.state).toBe("not_connected");
    expect(body.items.every((item) => item.connection === "not connected: no token")).toBe(true);
  });

  it("keeps the cached rules and shows the failed state after a failed fetch", async () => {
    const { app } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay", {
      forgeState: "rate limit",
      forgeErrorClass: "rate_limit",
      lastGoodFetchAt: new Date("2026-11-14T08:00:00Z"),
    });
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", CODING);

    const body = await view(app);
    expect(body.items[0]).toMatchObject({
      connection: "rate limit",
      dataAsOf: "2026-11-14T08:00:00.000Z",
    });
    expect(body.items[0]?.rules[0]?.state).toBe("current");
    expect(body.complete.incompleteRepos).toBeGreaterThanOrEqual(1);
  });

  it("does not read a template through a stamp version that leaves the cache", async () => {
    const { app, claudeDir } = await appFor({ plugins: { "factory-core": CORE } });
    await mkdir(path.join(claudeDir, "plugins", "templates", "rules"), { recursive: true });
    await writeFile(path.join(claudeDir, "plugins", "templates", "rules", "coding.md"), "# Out\n");
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    // The stamp version `..` would point from `factory-core/` to the cache folder of the Marketplace.
    await seedRule(PAY, "coding", `${stamp("factory-core", "..", "coding")}\n# Out\n`);

    expect(ruleOf(await view(app), PAY, "coding").state).toBe("differs");
  });

  it("skips a template over 1 MB and counts it", async () => {
    const big = "x".repeat(1_048_577);
    const { app } = await appFor({
      plugins: { "factory-core": { version: "0.30.0", templates: { rule: { coding: big } } } },
    });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", big);

    const body = await view(app);
    expect(ruleOf(body, PAY, "coding").state).toBe("no_template");
    expect(body.skipped.templates).toBe(1);
  });

  it("sends no local path, hash or file text", async () => {
    const { app, claudeDir } = await appFor({ plugins: { "factory-core": CORE } });
    await seedRepo(PAY, "acme", "pay");
    await seedConfig(PAY, { rules: ["coding"] });
    await seedRule(PAY, "coding", `${stamp("factory-core", "0.8.1", "coding")}\n${CODING}`);

    const response = await app.inject({ method: "GET", url: "/api/factory-health/rule-drift" });
    const text = response.body;
    expect(text).not.toContain(claudeDir);
    expect(text).not.toContain("/home/operator");
    expect(text).not.toContain("Validate input");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});
