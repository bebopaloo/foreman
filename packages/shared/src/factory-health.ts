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
