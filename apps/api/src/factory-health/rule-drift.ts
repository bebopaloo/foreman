import { schema, type Database } from "@foreman/db";
import {
  type RuleConfigState,
  type RuleDriftRepo,
  type RuleDriftRule,
  type RuleDriftState,
} from "@foreman/shared";
import { inArray } from "drizzle-orm";
import {
  listedRules,
  REPO_CONFIG_PATH,
  repoConfigFieldsSchema,
  rulePath,
  ruleFileFieldsSchema,
  type RepoConfigFields,
  type RuleFileFields,
  type RuleKind,
} from "../controls/files.ts";
import { ERROR_CLASS_STATE } from "../work/runner.ts";
import type { TemplateReader } from "./templates.ts";

const FACTORY_CORE = "factory-core";

export interface CachedRuleRepo {
  defaultBranch: string | null;
  fileBranch: string | null;
  repoState: string | null;
  connection: string;
  dataAsOf: Date | null;
}

interface CachedFileRow {
  state: string;
  errorClass: string | null;
  ref: string | null;
  fields: unknown;
}

/** The repo config row and the rule rows of each repo, from the Work cache. */
export async function readCachedRuleFiles(
  db: Database,
  repoIds: readonly string[],
): Promise<Map<string, Map<string, CachedFileRow>>> {
  const result = new Map<string, Map<string, CachedFileRow>>();
  if (repoIds.length === 0) return result;
  const rows = await db
    .select({
      repoId: schema.workForgeFiles.repoId,
      path: schema.workForgeFiles.path,
      state: schema.workForgeFiles.state,
      errorClass: schema.workForgeFiles.errorClass,
      ref: schema.workForgeFiles.ref,
      fields: schema.workForgeFiles.fields,
    })
    .from(schema.workForgeFiles)
    .where(inArray(schema.workForgeFiles.repoId, [...repoIds]));
  for (const row of rows) {
    const files = result.get(row.repoId) ?? new Map<string, CachedFileRow>();
    files.set(row.path, row);
    result.set(row.repoId, files);
  }
  return result;
}

function emptySummary(): Record<RuleDriftState, number> {
  return {
    current: 0,
    behind: 0,
    edited_by_team: 0,
    differs: 0,
    missing_file: 0,
    missing_ref: 0,
    no_template: 0,
    not_unique: 0,
    not_readable: 0,
    failed: 0,
    not_read: 0,
  };
}

/** The config state, and the config when its rules may show. */
function configOf(
  configRow: CachedFileRow | undefined,
  repoState: string | null,
): { state: RuleConfigState; config: RepoConfigFields | null } {
  if (repoState === "no_default_branch") return { state: "no_default_branch", config: null };
  if (configRow === undefined) return { state: "not_read", config: null };
  if (configRow.state === "missing_file") return { state: "not_set_up", config: null };
  if (configRow.state === "missing_ref") return { state: "branch_not_found", config: null };
  const parsed = repoConfigFieldsSchema.safeParse(configRow.fields);
  const config = parsed.success ? parsed.data : null;
  if (configRow.state === "failed") return { state: "failed", config };
  if (configRow.state !== "ok" || config === null) return { state: "not_readable", config: null };
  const keysValid =
    config.rules.state === "ok" &&
    config.compliance.state === "ok" &&
    config.stackPack.state === "ok" &&
    config.factoryCoreVersion.state === "ok";
  return keysValid ? { state: "ok", config } : { state: "not_readable", config: null };
}

interface RuleInput {
  name: string;
  kind: RuleKind;
  row: CachedFileRow | undefined;
}

function fileFailure(row: CachedFileRow | undefined): {
  state: RuleDriftState;
  errorState: string | null;
} | null {
  if (row === undefined) return { state: "not_read", errorState: null };
  if (row.state === "missing_file") return { state: "missing_file", errorState: null };
  if (row.state === "missing_ref") return { state: "missing_ref", errorState: null };
  if (row.state === "failed") {
    const text = Object.entries(ERROR_CLASS_STATE).find(([name]) => name === row.errorClass)?.[1];
    return { state: "failed", errorState: text ?? ERROR_CLASS_STATE.other };
  }
  if (row.state !== "ok") return { state: "not_readable", errorState: null };
  return null;
}

async function ruleOf(
  input: RuleInput,
  reader: TemplateReader,
  sourcePlugins: readonly string[],
): Promise<RuleDriftRule> {
  const { name, kind, row } = input;
  const base = {
    name,
    kind,
    errorState: null,
    ref: row?.ref ?? null,
    stampPlugin: null,
    stampVersion: null,
    sourcePlugin: null,
    sourceVersion: null,
  };
  const failure = fileFailure(row);
  if (failure !== null) return { ...base, ...failure };
  const parsed = ruleFileFieldsSchema.safeParse(row?.fields);
  if (!parsed.success || parsed.data.kind !== kind) return { ...base, state: "not_readable" };
  const fields: RuleFileFields = parsed.data;
  const stamped = {
    ...base,
    stampPlugin: fields.stampPlugin,
    stampVersion: fields.stampVersion,
  };

  const having: string[] = [];
  for (const plugin of sourcePlugins) {
    if ((await reader.names(plugin, kind)).has(name)) having.push(plugin);
  }
  const owner = having[0];
  if (having.length > 1) return { ...stamped, state: "not_unique" };
  if (owner === undefined) return { ...stamped, state: "no_template" };
  const withSource = {
    ...stamped,
    sourcePlugin: owner,
    sourceVersion: reader.source(owner)?.version ?? null,
  };

  const installed = await reader.installedHash(owner, kind, name);
  if (installed === undefined) return { ...withSource, state: "no_template" };
  if (fields.textHash === installed) return { ...withSource, state: "current" };
  if (fields.stampPlugin === null || fields.stampVersion === null) {
    return { ...withSource, state: "differs" };
  }
  const atStamp = await reader.cachedHash(fields.stampPlugin, fields.stampVersion, kind, name);
  if (atStamp === undefined) return { ...withSource, state: "differs" };
  return { ...withSource, state: fields.textHash === atStamp ? "behind" : "edited_by_team" };
}

export interface RuleDriftInput {
  repoId: string;
  repo: string;
  cache: CachedRuleRepo | undefined;
  files: ReadonlyMap<string, CachedFileRow> | undefined;
}

/** The drift of the rule files of one repo, against the templates that are installed now. */
export async function ruleDriftOf(
  input: RuleDriftInput,
  reader: TemplateReader,
): Promise<RuleDriftRepo> {
  const { repoId, repo, cache, files } = input;
  const { state, config } = configOf(files?.get(REPO_CONFIG_PATH), cache?.repoState ?? null);

  const stackPack = config?.stackPack.state === "ok" ? config.stackPack.value : null;
  const installedStack = stackPack === null ? null : reader.source(stackPack.name) !== undefined;
  const sourcePlugins = [FACTORY_CORE, ...(stackPack === null ? [] : [stackPack.name])].filter(
    (plugin, index, all) => all.indexOf(plugin) === index && reader.source(plugin) !== undefined,
  );

  const listed = config === null ? null : listedRules(config);
  const rules: RuleDriftRule[] = [];
  const summary = emptySummary();
  if (listed !== null) {
    for (const { name, kind } of listed) {
      const rule = await ruleOf(
        { name, kind, row: files?.get(rulePath(name)) },
        reader,
        sourcePlugins,
      );
      summary[rule.state] += 1;
      rules.push(rule);
    }
  }

  return {
    repoId,
    repo,
    connection: cache?.connection ?? "not fetched",
    dataAsOf: cache?.dataAsOf?.toISOString() ?? null,
    defaultBranch: cache?.defaultBranch ?? null,
    fileBranch: cache?.fileBranch ?? null,
    mainBranch: config?.mainBranch ?? null,
    configState: state,
    factoryCoreVersion:
      config?.factoryCoreVersion.state === "ok" ? config.factoryCoreVersion.value : null,
    stackPack,
    stackPackInstalled: installedStack,
    installedFactoryCoreVersion: reader.source(FACTORY_CORE)?.version ?? null,
    summary,
    rules,
  };
}
