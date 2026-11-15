import { z } from "zod";
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
