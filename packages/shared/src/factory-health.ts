import { z } from "zod";
import { ClientName } from "./client.ts";
import { BuildResult } from "./dash.ts";
import { pageQueryShape, pageResponseSchema } from "./paging.ts";

export const PLUGINS_DEFAULT_LIMIT = 100;
export const PLUGINS_MAX_LIMIT = 500;

// No `client` here: the plugins belong to the whole factory, and `.strict()` refuses the key.
export const PluginVersionsQuery = z
  .object(pageQueryShape({ defaultLimit: PLUGINS_DEFAULT_LIMIT, maxLimit: PLUGINS_MAX_LIMIT }))
  .strict();
export type PluginVersionsQuery = z.infer<typeof PluginVersionsQuery>;

export const PluginState = z.enum([
  "current",
  "update_available",
  "newer_than_marketplace",
  "differs_from_marketplace",
  "not_in_marketplace",
  "marketplace_not_known",
  "marketplace_not_readable",
  "version_not_in_marketplace_copy",
  "version_not_readable",
  "no_user_install",
]);
export type PluginState = z.infer<typeof PluginState>;

export const MarketplaceRow = z
  .object({
    name: z.string(),
    sourceKind: z.string().nullable(),
    lastUpdated: z.iso.datetime().nullable(),
    state: z.enum(["readable", "not_readable"]),
    /** A `directory` Marketplace: a working folder that Foreman reads as it is now. */
    localFolder: z.boolean(),
  })
  .strict();
export type MarketplaceRow = z.infer<typeof MarketplaceRow>;

export const PluginRow = z
  .object({
    key: z.string(),
    plugin: z.string(),
    marketplace: z.string(),
    installedVersion: z.string().nullable(),
    installLastUpdated: z.iso.datetime().nullable(),
    marketplaceVersion: z.string().nullable(),
    state: PluginState,
    otherScopeInstalls: z.number().int().min(0),
  })
  .strict();
export type PluginRow = z.infer<typeof PluginRow>;

export const PluginVersionsResponse = pageResponseSchema(PluginRow)
  .extend({
    /** `missing` when `installed_plugins.json` is missing or not readable. */
    pluginData: z.enum(["ok", "missing"]),
    marketplaces: z.array(MarketplaceRow),
    skipped: z.object({ files: z.number().int().min(0) }).strict(),
  })
  .strict();
export type PluginVersionsResponse = z.infer<typeof PluginVersionsResponse>;

export const RUNS_DEFAULT_LIMIT = 30;
export const RUNS_MAX_LIMIT = 100;

/** `client` is the Client scope; the route holds no data of other clients. */
export const FactoryRunsQuery = z
  .object({
    client: ClientName.optional(),
    ...pageQueryShape({ defaultLimit: RUNS_DEFAULT_LIMIT, maxLimit: RUNS_MAX_LIMIT }),
  })
  .strict();
export type FactoryRunsQuery = z.infer<typeof FactoryRunsQuery>;

/** A build that a run left before its end. */
export const StoppedItem = z
  .object({
    /** The repo ID, or null for a repo folder that is not in the repo list. */
    repoId: z.string().nullable(),
    /** `owner/name`, or the last part of the repo folder. */
    repo: z.string(),
    issue: z.number().int().positive(),
    result: z.enum(["in review", "stopped at run end"]),
    /** From the Work cache. Null when the cache has no row for the issue. */
    title: z.string().nullable(),
    link: z.string().nullable(),
    /** The window start of the first later run with a line for the issue, or null. */
    resumedBy: z.iso.datetime().nullable(),
  })
  .strict();
export type StoppedItem = z.infer<typeof StoppedItem>;

export const FactoryRunRow = z
  .object({
    runId: z.string(),
    start: z.iso.datetime(),
    /** The time of the last line, or now for a run in progress. */
    end: z.iso.datetime(),
    running: z.boolean(),
    builds: z.number().int().min(0),
    /** The count of builds for each result. */
    results: z.record(BuildResult, z.number().int().min(0)),
    peak: z.number().int().min(0),
    /** The count of build slots. Only in the scope "All". */
    slotLimit: z.number().int().positive().nullable(),
    skips: z.number().int().min(0),
    blockedAtSelection: z.number().int().min(0),
    stoppedItems: z.array(StoppedItem),
  })
  .strict();
export type FactoryRunRow = z.infer<typeof FactoryRunRow>;

export const FactoryRunsResponse = pageResponseSchema(FactoryRunRow)
  .extend({
    /** The state of the `runs/` folder. */
    sources: z.object({ runs: z.enum(["ok", "missing", "unreadable"]) }).strict(),
    skipped: z
      .object({ nightLogLines: z.number().int().min(0), files: z.number().int().min(0) })
      .strict(),
  })
  .strict();
export type FactoryRunsResponse = z.infer<typeof FactoryRunsResponse>;

export const RULE_DRIFT_DEFAULT_LIMIT = 50;
export const RULE_DRIFT_MAX_LIMIT = 200;

/** `client` is the Client scope. `repo` is a repo ID, and it must belong to the `client`. */
export const RuleDriftQuery = z
  .object({
    client: ClientName.optional(),
    repo: z
      .string()
      .regex(/^[0-9a-f]{12}$/)
      .optional(),
    ...pageQueryShape({ defaultLimit: RULE_DRIFT_DEFAULT_LIMIT, maxLimit: RULE_DRIFT_MAX_LIMIT }),
  })
  .strict();
export type RuleDriftQuery = z.infer<typeof RuleDriftQuery>;

export const RULE_DRIFT_STATES = [
  "current",
  "behind",
  "edited_by_team",
  "differs",
  "missing_file",
  "missing_ref",
  "no_template",
  "not_unique",
  "not_readable",
  "failed",
  "not_read",
] as const;
export const RuleDriftState = z.enum(RULE_DRIFT_STATES);
export type RuleDriftState = z.infer<typeof RuleDriftState>;

export const RuleDriftRule = z
  .object({
    name: z.string(),
    kind: z.enum(["rule", "compliance"]),
    state: RuleDriftState,
    /** The text of the adapter error class, for the state `failed`. */
    errorState: z.string().nullable(),
    /** The ref of the rule file in the cache, or null when no step has read it. */
    ref: z.string().nullable(),
    stampPlugin: z.string().nullable(),
    stampVersion: z.string().nullable(),
    /** The plugin whose installed template the rule uses, or null with no one template. */
    sourcePlugin: z.string().nullable(),
    /** The installed version of that plugin. */
    sourceVersion: z.string().nullable(),
  })
  .strict();
export type RuleDriftRule = z.infer<typeof RuleDriftRule>;

export const RULE_CONFIG_STATES = [
  "ok",
  "not_read",
  "not_set_up",
  "branch_not_found",
  "not_readable",
  "failed",
  "no_default_branch",
] as const;
export const RuleConfigState = z.enum(RULE_CONFIG_STATES);
export type RuleConfigState = z.infer<typeof RuleConfigState>;

export const RuleDriftRepo = z
  .object({
    repoId: z.string(),
    /** `owner/name`. */
    repo: z.string(),
    /** The connection state of Spec 23, or "not connected: no token". */
    connection: z.string(),
    dataAsOf: z.iso.datetime().nullable(),
    defaultBranch: z.string().nullable(),
    /** The ref of the rule files. It differs from the default branch when `main_branch` is set. */
    fileBranch: z.string().nullable(),
    mainBranch: z.string().nullable(),
    configState: RuleConfigState,
    factoryCoreVersion: z.string().nullable(),
    stackPack: z.object({ name: z.string(), version: z.string() }).strict().nullable(),
    /** Null when the factory config names no Stack pack. */
    stackPackInstalled: z.boolean().nullable(),
    /** The installed version of `factory-core`, or null when it is not installed. */
    installedFactoryCoreVersion: z.string().nullable(),
    summary: z.record(RuleDriftState, z.number().int().min(0)),
    rules: z.array(RuleDriftRule),
  })
  .strict();
export type RuleDriftRepo = z.infer<typeof RuleDriftRepo>;

export const RuleDriftResponse = pageResponseSchema(RuleDriftRepo)
  .extend({
    /** `not_connected` when no repo in scope has cache rows. */
    state: z.enum(["ok", "not_connected"]),
    complete: z.object({ incompleteRepos: z.number().int().min(0) }).strict(),
    skipped: z.object({ templates: z.number().int().min(0) }).strict(),
  })
  .strict();
export type RuleDriftResponse = z.infer<typeof RuleDriftResponse>;
