import { createHash } from "node:crypto";
import { parse as parseToml, TomlDate } from "smol-toml";
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

const RULE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const RULE_LIST_MAX = 50;

/** The input of a rule list: at most 50 names that the rule path pattern accepts. */
const nameListSchema = z.array(z.string().regex(RULE_NAME)).max(RULE_LIST_MAX);

/** The `stack_pack` key: `null`, or the name and the version of the Stack pack. */
const stackPackInputSchema = z
  .object({ name: z.string().regex(RULE_NAME), version: z.string().regex(VERSION) })
  .nullable();

/** A key that Foreman validates alone: its value, or the state that it failed. */
function keyOf<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("ok"), value }).strict(),
    z.object({ state: z.literal("not_valid") }).strict(),
  ]);
}

/** The fields of the repo config that Foreman keeps. */
export const repoConfigFieldsSchema = z
  .object({
    mainBranch: z.string().nullable(),
    rules: keyOf(nameListSchema),
    compliance: keyOf(nameListSchema),
    stackPack: keyOf(stackPackInputSchema),
    factoryCoreVersion: keyOf(z.string().regex(VERSION).nullable()),
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
export type RuleKind = "rule" | "compliance";

/** The path of the rule file of a name. */
export function rulePath(name: string): string {
  return `.claude/rules/${name}.md`;
}

/** True when the path is the path of a rule file. */
export function isRulePath(path: string): boolean {
  return RULE_PATH.test(path);
}

const RULE_PATH = /^\.claude\/rules\/[a-z0-9][a-z0-9-]*\.md$/;

/** The rule names that a valid repo config lists, each once, with its kind. `rules` comes first. */
export function listedRules(fields: RepoConfigFields): { name: string; kind: RuleKind }[] | null {
  if (fields.rules.state !== "ok" || fields.compliance.state !== "ok") return null;
  const seen = new Set<string>();
  const listed: { name: string; kind: RuleKind }[] = [];
  for (const [names, kind] of [
    [fields.rules.value, "rule"],
    [fields.compliance.value, "compliance"],
  ] as const) {
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      listed.push({ name, kind });
    }
  }
  return listed;
}

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

  // A missing key is an empty list or null. A key that fails its schema fails alone.
  const keyed = <T extends z.ZodType>(name: string, schema: T, absent: z.infer<T>) => {
    if (!(name in json)) return { state: "ok" as const, value: absent };
    const parsed = schema.safeParse(json[name]);
    return parsed.success
      ? { state: "ok" as const, value: parsed.data }
      : { state: "not_valid" as const };
  };
  const rules = keyed("rules", nameListSchema, []);
  const compliance = keyed("compliance", nameListSchema, []);
  const stackPack = keyed("stack_pack", stackPackInputSchema, null);
  const factoryCoreVersion = keyed(
    "factory_core_version",
    z.string().regex(VERSION).nullable(),
    null,
  );

  return {
    ok: true,
    fields: {
      mainBranch,
      rules,
      compliance,
      stackPack,
      factoryCoreVersion,
      controls,
      releases,
    },
  };
}

/** The parsed fields of a rule file. They never hold the text. */
export const ruleFileFieldsSchema = z
  .object({
    kind: z.enum(["rule", "compliance"]),
    stampPlugin: z.string().nullable(),
    stampVersion: z.string().nullable(),
    stampName: z.string().nullable(),
    textHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type RuleFileFields = z.infer<typeof ruleFileFieldsSchema>;

const STAMP_LINE =
  /^<!-- ([a-z0-9][a-z0-9-]*) ([0-9A-Za-z.+-]{1,64}): from Rule template ([a-z0-9][a-z0-9-]*)\. The team owns this file\. -->$/;

/**
 * Reads a rule file as `context-init` writes it. The stamp is the first line, or the line after
 * the front matter. It counts only when its template name is the rule name. The hash is the
 * SHA-256 of the text without the stamp line, or of the whole text when no stamp counts.
 */
export function parseRuleFile(name: string, kind: RuleKind, text: string): RuleFileFields {
  let start = 0;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end !== -1) start = end + "\n---\n".length;
  }
  const lineEnd = text.indexOf("\n", start);
  const stop = lineEnd === -1 ? text.length : lineEnd + 1;
  const line = text.slice(start, lineEnd === -1 ? text.length : lineEnd);
  const match = STAMP_LINE.exec(line);
  const stamp = match !== null && match[3] === name ? match : null;
  const body = stamp === null ? text : text.slice(0, start) + text.slice(stop);
  return {
    kind,
    stampPlugin: stamp?.[1] ?? null,
    stampVersion: stamp?.[2] ?? null,
    stampName: stamp?.[3] ?? null,
    textHash: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

// The module files. Each parser follows the factory script that checks its file, keeps only the
// fields of Spec 67, and skips an entry that fails its rules. A skipped entry records its
// position (counted from 1 in its table) and the name of the failed field, never a value.

export const skippedEntriesSchema = z.array(
  z.object({ position: z.number().int().min(1), field: z.string().min(1) }).strict(),
);
export type SkippedEntries = z.infer<typeof skippedEntriesSchema>;

const TITLE_MAX = 200;
const RISK_TIERS = ["authority", "sensitive", "general", "inert"] as const;
const TIER_KEYS: ReadonlySet<string> = new Set(["name", "paths"]);
const BOUNDARY_KEYS: ReadonlySet<string> = new Set(["id", "paths"]);
const BOUNDARY_ID = /^TB-[0-9]+$/;
const CONTROL_ID = /^CTRL-[A-Z]+-[0-9]+$/;
const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "sources",
  "owner",
  "modules",
  "manual_checks",
]);
const WAIVER_ID = /^WAIVER-[0-9]+$/;
const WAIVER_KEYS: ReadonlySet<string> = new Set([
  "id",
  "reason",
  "risk",
  "owner",
  "approved_by",
  "created",
  "expires",
  "covers",
]);
const STRIDE: readonly string[] = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information disclosure",
  "Denial of service",
  "Elevation of privilege",
];

const count = z.number().int().min(0);
const dateText = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

export const riskMapFieldsSchema = z
  .object({
    tiers: z.object({ authority: count, sensitive: count, general: count, inert: count }).strict(),
    boundaries: z.array(
      z.object({ id: z.string().regex(BOUNDARY_ID), globs: z.number().int().min(1) }).strict(),
    ),
  })
  .strict();
export type RiskMapFields = z.infer<typeof riskMapFieldsSchema>;

export const controlRegisterFieldsSchema = z
  .object({
    controls: z.array(
      z
        .object({
          id: z.string().regex(CONTROL_ID),
          title: z.string().max(TITLE_MAX),
          owner: z.string().min(1),
          sources: count,
          modules: z.number().int().min(1),
          manualChecks: count,
        })
        .strict(),
    ),
  })
  .strict();
export type ControlRegisterFields = z.infer<typeof controlRegisterFieldsSchema>;

const waiverCoversSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("finding"),
      file: z.string().min(1),
      category: z.string().min(1),
      ref: z.string().min(1).nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("check"), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("control"), id: z.string().min(1) }).strict(),
]);
export type WaiverCovers = z.infer<typeof waiverCoversSchema>;

/** A Waiver has no `reason` and no `risk` here: Foreman never keeps them. */
export const waiverRegisterFieldsSchema = z
  .object({
    waivers: z.array(
      z
        .object({
          id: z.string().regex(WAIVER_ID),
          owner: z.string().min(1),
          approvedBy: z.string().min(1),
          created: dateText,
          expires: dateText,
          covers: waiverCoversSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type WaiverRegisterFields = z.infer<typeof waiverRegisterFieldsSchema>;

export const threatModelFieldsSchema = z
  .object({
    boundaries: z.array(z.string().regex(BOUNDARY_ID)),
    threats: z.array(
      z
        .object({
          id: z.string().regex(/^TM-[0-9]+$/),
          boundary: z.string().regex(BOUNDARY_ID),
          stride: z.array(z.string()),
          controls: z.array(z.string().regex(CONTROL_ID)),
        })
        .strict(),
    ),
  })
  .strict();
export type ThreatModelFields = z.infer<typeof threatModelFieldsSchema>;

/** The parsed fields of any module file. */
export const moduleFileFieldsSchema = z.union([
  riskMapFieldsSchema,
  controlRegisterFieldsSchema,
  waiverRegisterFieldsSchema,
  threatModelFieldsSchema,
]);
export type ModuleFileFields = z.infer<typeof moduleFileFieldsSchema>;

export type ModuleFileResult<T> = { ok: true; fields: T; skipped: SkippedEntries } | { ok: false };

const NOT_READABLE = { ok: false } as const;

function readToml(content: string): Record<string, unknown> | null {
  try {
    return parseToml(content);
  } catch {
    return null;
  }
}

function hasUnknownKey(entry: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(entry).some((key) => !allowed.has(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function textList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function globList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyText);
}

/** The tables of a TOML key, none when the key is absent, or null when the key is not a list. */
function tableList(data: Record<string, unknown>, name: string): unknown[] | null {
  const value = data[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : null;
}

/** A TOML local date, as `YYYY-MM-DD`. Waiver dates are dates, not date-times, as `waivers.py` decides. */
function localDate(value: unknown): string | null {
  return value instanceof TomlDate && value.isDate() ? value.toISOString().slice(0, 10) : null;
}

/** The Risk map, as `risk_tier.py` checks it. A tier or boundary that fails its rules is skipped. */
export function parseRiskMap(content: string): ModuleFileResult<RiskMapFields> {
  const data = readToml(content);
  if (data === null) return NOT_READABLE;
  const tiers = tableList(data, "tier");
  const boundaries = tableList(data, "boundary");
  if (tiers === null || boundaries === null) return NOT_READABLE;

  const skipped: SkippedEntries = [];
  const counts = { authority: 0, sensitive: 0, general: 0, inert: 0 };
  const seenTiers = new Set<string>();
  tiers.forEach((entry, index) => {
    const position = index + 1;
    const skip = (field: string) => skipped.push({ position, field });
    if (!isObject(entry)) return skip("tier");
    const tier = RISK_TIERS.find((candidate) => candidate === entry.name);
    if (tier === undefined || seenTiers.has(tier)) return skip("tier.name");
    if (hasUnknownKey(entry, TIER_KEYS)) return skip("tier.unknown_key");
    if (!globList(entry.paths)) return skip("tier.paths");
    seenTiers.add(tier);
    counts[tier] += entry.paths.length;
  });

  const kept: RiskMapFields["boundaries"] = [];
  const seenBoundaries = new Set<string>();
  boundaries.forEach((entry, index) => {
    const position = index + 1;
    const skip = (field: string) => skipped.push({ position, field });
    if (!isObject(entry)) return skip("boundary");
    const id = entry.id;
    if (typeof id !== "string" || !BOUNDARY_ID.test(id) || seenBoundaries.has(id)) {
      return skip("boundary.id");
    }
    if (hasUnknownKey(entry, BOUNDARY_KEYS)) return skip("boundary.unknown_key");
    if (!globList(entry.paths)) return skip("boundary.paths");
    seenBoundaries.add(id);
    kept.push({ id, globs: entry.paths.length });
  });
  return { ok: true, fields: { tiers: counts, boundaries: kept }, skipped };
}

/** The Control register, as `controls.py` checks it. The optional top-level `tests` key is not kept. */
export function parseControlRegister(content: string): ModuleFileResult<ControlRegisterFields> {
  const data = readToml(content);
  if (data === null) return NOT_READABLE;
  const entries = tableList(data, "control");
  if (entries === null) return NOT_READABLE;

  const skipped: SkippedEntries = [];
  const kept: ControlRegisterFields["controls"] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const position = index + 1;
    const skip = (field: string) => skipped.push({ position, field });
    if (!isObject(entry)) return skip("control");
    const id = entry.id;
    if (typeof id !== "string" || !CONTROL_ID.test(id) || seen.has(id)) return skip("id");
    if (hasUnknownKey(entry, CONTROL_KEYS)) return skip("unknown_key");
    const { title, owner, modules, sources, manual_checks: manualChecks } = entry;
    if (!nonEmptyText(title)) return skip("title");
    if (!nonEmptyText(owner)) return skip("owner");
    if (!textList(modules) || modules.length === 0) return skip("modules");
    if (sources !== undefined && !textList(sources)) return skip("sources");
    if (manualChecks !== undefined && !textList(manualChecks)) return skip("manual_checks");
    seen.add(id);
    kept.push({
      id,
      title: title.slice(0, TITLE_MAX),
      owner,
      sources: sources?.length ?? 0,
      modules: modules.length,
      manualChecks: manualChecks?.length ?? 0,
    });
  });
  return { ok: true, fields: { controls: kept }, skipped };
}

function parseCovers(value: unknown): { covers: WaiverCovers } | { field: string } {
  if (!isObject(value)) return { field: "covers" };
  const { kind } = value;
  const allowed =
    kind === "finding"
      ? ["kind", "file", "category", "ref"]
      : kind === "check"
        ? ["kind", "name"]
        : kind === "control"
          ? ["kind", "id"]
          : null;
  if (allowed === null) return { field: "covers.kind" };
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    return { field: "covers.unknown_key" };
  }
  if (kind === "check") {
    return nonEmptyText(value.name)
      ? { covers: { kind, name: value.name } }
      : { field: "covers.name" };
  }
  if (kind === "control") {
    return nonEmptyText(value.id) ? { covers: { kind, id: value.id } } : { field: "covers.id" };
  }
  if (!nonEmptyText(value.file)) return { field: "covers.file" };
  if (!nonEmptyText(value.category)) return { field: "covers.category" };
  if (value.ref !== undefined && typeof value.ref !== "string") return { field: "covers.ref" };
  const ref = value.ref === undefined || value.ref === "" ? null : value.ref;
  return { covers: { kind: "finding", file: value.file, category: value.category, ref } };
}

/**
 * The Waiver register, as `waivers.py` checks it. `reason` and `risk` must be present, as the
 * factory demands, but Foreman never keeps them. The `waiver_max_days` setting and the expiry
 * are not applied here: the Waivers view decides them against the current date.
 */
export function parseWaiverRegister(content: string): ModuleFileResult<WaiverRegisterFields> {
  const data = readToml(content);
  if (data === null) return NOT_READABLE;
  const entries = tableList(data, "waiver");
  if (entries === null) return NOT_READABLE;

  const skipped: SkippedEntries = [];
  const kept: WaiverRegisterFields["waivers"] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const position = index + 1;
    const skip = (field: string) => skipped.push({ position, field });
    if (!isObject(entry)) return skip("waiver");
    const id = entry.id;
    if (typeof id !== "string" || !WAIVER_ID.test(id) || seen.has(id)) return skip("id");
    if (hasUnknownKey(entry, WAIVER_KEYS)) return skip("unknown_key");
    if (!nonEmptyText(entry.reason)) return skip("reason");
    if (!nonEmptyText(entry.risk)) return skip("risk");
    const { owner, approved_by: approvedBy } = entry;
    if (!nonEmptyText(owner)) return skip("owner");
    if (!nonEmptyText(approvedBy)) return skip("approved_by");
    const covers = parseCovers(entry.covers);
    if ("field" in covers) return skip(covers.field);
    const created = localDate(entry.created);
    if (created === null) return skip("created");
    const expires = localDate(entry.expires);
    if (expires === null || expires < created) return skip("expires");
    seen.add(id);
    kept.push({ id, owner, approvedBy, created, expires, covers: covers.covers });
  });
  return { ok: true, fields: { waivers: kept }, skipped };
}

const BOUNDARY_HEADING = /^## (TB-[0-9]+)\s+(.*)$/;
const THREAT_HEADING = /^### (TM-[0-9]+)\s+(.*)$/;
const THREAT_FIELD = /^- (STRIDE|Controls):\s*(.*)$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// The line breaks of Python's `str.splitlines`, which `controls.py` uses.
// eslint-disable-next-line no-control-regex -- these control characters are line breaks
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

interface ThreatDraft {
  id: string;
  boundary: string | null;
  stride: string[] | null;
  controls: string[] | null;
  /** The first failed field of the threat. */
  failed: string | null;
}

/**
 * The Threat model, read by the rules of `_read_threats` in `controls.py`: HTML comments are left
 * out, `## TB-<n>` starts a boundary and `### TM-<n>` starts a threat. A threat with a problem is
 * skipped. The names and the other lines are never kept.
 */
export function parseThreatModel(content: string): ModuleFileResult<ThreatModelFields> {
  const boundaries: string[] = [];
  const skipped: SkippedEntries = [];
  const threats: ThreatDraft[] = [];
  const seenThreats = new Set<string>();
  let boundary: string | null = null;
  let current: ThreatDraft | null = null;
  let boundaryPosition = 0;

  for (const line of content.replace(HTML_COMMENT, "").split(LINE_BREAK)) {
    const boundaryMatch = BOUNDARY_HEADING.exec(line);
    const threatMatch = THREAT_HEADING.exec(line);
    const fieldMatch = THREAT_FIELD.exec(line);
    if (boundaryMatch) {
      boundaryPosition += 1;
      const id = boundaryMatch[1] ?? "";
      boundary = id;
      current = null;
      if (boundaries.includes(id)) {
        skipped.push({ position: boundaryPosition, field: "boundary.id" });
      } else {
        boundaries.push(id);
      }
    } else if (threatMatch) {
      const id = threatMatch[1] ?? "";
      current = {
        id,
        boundary,
        stride: null,
        controls: null,
        failed: seenThreats.has(id) ? "threat.id" : boundary === null ? "threat.boundary" : null,
      };
      seenThreats.add(id);
      threats.push(current);
    } else if (line.startsWith("## ")) {
      boundary = null;
      current = null;
    } else if (current !== null && fieldMatch) {
      const value = fieldMatch[2] ?? "";
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
      if (fieldMatch[1] === "STRIDE") {
        current.stride = items;
        if (!items.every((item) => STRIDE.includes(item))) current.failed ??= "threat.stride";
      } else {
        current.controls = value.trim().toLowerCase() === "none" ? [] : items;
        if (!current.controls.every((item) => CONTROL_ID.test(item))) {
          current.failed ??= "threat.controls";
        }
      }
    }
  }

  const kept: ThreatModelFields["threats"] = [];
  threats.forEach((threat, index) => {
    const position = index + 1;
    const failed = threat.failed;
    if (failed !== null) return skipped.push({ position, field: failed });
    if (threat.boundary === null) return skipped.push({ position, field: "threat.boundary" });
    if (threat.stride === null) return skipped.push({ position, field: "threat.stride" });
    if (threat.controls === null) return skipped.push({ position, field: "threat.controls" });
    kept.push({
      id: threat.id,
      boundary: threat.boundary,
      stride: threat.stride,
      controls: threat.controls,
    });
  });
  return { ok: true, fields: { boundaries, threats: kept }, skipped };
}

/** The parser of one module file, by its path. A path with no parser here returns null. */
export function parseModuleFile(
  path: string,
  content: string,
): ModuleFileResult<ModuleFileFields> | null {
  const file = MODULE_FILES.find((candidate) => candidate.path === path);
  switch (file?.module) {
    case "risk_tiers":
      return parseRiskMap(content);
    case "control_register":
      return parseControlRegister(content);
    case "waivers":
      return parseWaiverRegister(content);
    case "threat_model":
      return parseThreatModel(content);
    default:
      return null;
  }
}
