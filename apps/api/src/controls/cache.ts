import { schema, type Database } from "@foreman/db";
import type { z } from "zod";
import { inArray } from "drizzle-orm";
import {
  controlRegisterFieldsSchema,
  REPO_CONFIG_PATH,
  riskMapFieldsSchema,
  skippedEntriesSchema,
  threatModelFieldsSchema,
  waiverRegisterFieldsSchema,
  type SkippedEntries,
} from "./files.ts";

export const RISK_MAP_PATH = "_context/controls/risk-map.toml";
export const CONTROL_REGISTER_PATH = "_context/controls/controls.toml";
export const WAIVER_REGISTER_PATH = "_context/controls/waivers.toml";
export const THREAT_MODEL_PATH = "_context/threat-model.md";

export interface CachedFile<Fields> {
  state: string;
  ref: string | null;
  sha: string | null;
  fetchedAt: Date;
  skipped: SkippedEntries;
  /** The parsed fields, or null when the row has none or they fail the schema on read. */
  fields: Fields | null;
}

export interface CachedFiles {
  riskMap: CachedFile<z.infer<typeof riskMapFieldsSchema>> | undefined;
  controlRegister: CachedFile<z.infer<typeof controlRegisterFieldsSchema>> | undefined;
  waiverRegister: CachedFile<z.infer<typeof waiverRegisterFieldsSchema>> | undefined;
  threatModel: CachedFile<z.infer<typeof threatModelFieldsSchema>> | undefined;
}

/** The module files of each repo, read from the Work cache and validated again on read. */
export async function readModuleFiles(
  db: Database,
  repoIds: readonly string[],
): Promise<Map<string, CachedFiles>> {
  const result = new Map<string, CachedFiles>();
  if (repoIds.length === 0) return result;
  const rows = await db
    .select({
      repoId: schema.workForgeFiles.repoId,
      path: schema.workForgeFiles.path,
      ref: schema.workForgeFiles.ref,
      sha: schema.workForgeFiles.sha,
      fetchedAt: schema.workForgeFiles.fetchedAt,
      state: schema.workForgeFiles.state,
      skipped: schema.workForgeFiles.skipped,
      fields: schema.workForgeFiles.fields,
    })
    .from(schema.workForgeFiles)
    .where(inArray(schema.workForgeFiles.repoId, [...repoIds]));

  function entry<Schema extends z.ZodType>(
    row: (typeof rows)[number],
    fieldsSchema: Schema,
  ): CachedFile<z.infer<Schema>> {
    const fields = fieldsSchema.safeParse(row.fields);
    const skipped = skippedEntriesSchema.safeParse(row.skipped);
    return {
      state: row.state,
      ref: row.ref,
      sha: row.sha,
      fetchedAt: row.fetchedAt,
      skipped: skipped.success ? skipped.data : [],
      fields: fields.success ? fields.data : null,
    };
  }

  for (const row of rows) {
    if (row.path === REPO_CONFIG_PATH) continue;
    const files = result.get(row.repoId) ?? {
      riskMap: undefined,
      controlRegister: undefined,
      waiverRegister: undefined,
      threatModel: undefined,
    };
    if (row.path === RISK_MAP_PATH) files.riskMap = entry(row, riskMapFieldsSchema);
    else if (row.path === CONTROL_REGISTER_PATH) {
      files.controlRegister = entry(row, controlRegisterFieldsSchema);
    } else if (row.path === WAIVER_REGISTER_PATH) {
      files.waiverRegister = entry(row, waiverRegisterFieldsSchema);
    } else if (row.path === THREAT_MODEL_PATH)
      files.threatModel = entry(row, threatModelFieldsSchema);
    else continue;
    result.set(row.repoId, files);
  }
  return result;
}
