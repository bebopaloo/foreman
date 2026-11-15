import { z } from "zod";

/** The path of the repo config. Foreman reads it always, at the default branch. */
export const REPO_CONFIG_PATH = ".claude/factory.json";

/** A Forge file of Spec 67 that another file does not gate: it is read only when its module is on. */
export interface ModuleFile {
  path: string;
  module: string;
}

/** The other Forge files of Spec 67, in the order that the step reads them. */
export const MODULE_FILES: readonly ModuleFile[] = [
  { path: "_context/controls/risk-map.toml", module: "risk_tiers" },
  { path: "_context/controls/controls.toml", module: "control_register" },
  { path: "_context/controls/waivers.toml", module: "waivers" },
  { path: "_context/threat-model.md", module: "threat_model" },
];

const MODULE_NAME = /^[a-z_]+$/;

/** The `controls` key, in the shape that `factory_config.py` checks. */
const controlsSchema = z
  .object({
    profile: z.string(),
    modules: z
      .array(z.string().regex(MODULE_NAME))
      .refine((names) => new Set(names).size === names.length),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** The `releases` key, as `context_init.py` writes it. */
const releasesSchema = z
  .object({
    production_branch: z.string().min(1),
    baseline: z.string().min(1),
    switched_over: z.string().min(1),
  })
  .strict();

/** The fields of the repo config that Foreman keeps. Spec 71 adds its keys here. */
export const repoConfigFieldsSchema = z
  .object({
    mainBranch: z.string().nullable(),
    controls: z.discriminatedUnion("state", [
      z.object({ state: z.literal("none") }).strict(),
      z.object({ state: z.literal("not_valid") }).strict(),
      z
        .object({
          state: z.literal("ok"),
          profile: z.string(),
          modules: z.array(z.string()),
        })
        .strict(),
    ]),
    releases: z
      .object({ productionBranch: z.string(), switchedOver: z.string() })
      .strict()
      .nullable(),
  })
  .strict();

export type RepoConfigFields = z.infer<typeof repoConfigFieldsSchema>;
export type ControlsState = RepoConfigFields["controls"];

export type RepoConfigResult = { ok: true; fields: RepoConfigFields } | { ok: false };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the repo config. It reads only the keys that Foreman uses and validates each one
 * alone, so a key that fails does not fail another key. It ignores every other key, because
 * the factory owns the file and adds keys to it. A text that is not a JSON object is not readable.
 */
export function parseRepoConfig(content: string): RepoConfigResult {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  if (!isObject(json)) return { ok: false };

  const mainBranch = typeof json.main_branch === "string" ? json.main_branch : null;

  let controls: ControlsState = { state: "none" };
  if ("controls" in json) {
    const parsed = controlsSchema.safeParse(json.controls);
    controls = parsed.success
      ? { state: "ok", profile: parsed.data.profile, modules: parsed.data.modules }
      : { state: "not_valid" };
  }

  const releasesParsed = releasesSchema.safeParse(json.releases);
  const releases = releasesParsed.success
    ? {
        productionBranch: releasesParsed.data.production_branch,
        switchedOver: releasesParsed.data.switched_over,
      }
    : null;

  return { ok: true, fields: { mainBranch, controls, releases } };
}
