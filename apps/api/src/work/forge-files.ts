import { schema, type Database } from "@foreman/db";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import {
  MODULE_FILES,
  moduleFileFieldsSchema,
  parseModuleFile,
  parseRepoConfig,
  REPO_CONFIG_PATH,
  repoConfigFieldsSchema,
  skippedEntriesSchema,
  type RepoConfigFields,
} from "../controls/files.ts";
import { fileBranchFor, filesToRead, usableDefaultBranch } from "../controls/modules.ts";
import { contractSchemas } from "./contract.ts";
import type { ErrorClass } from "./runner.ts";

const FORGE_FILES_STALE_MS = 60 * 60 * 1000;

export type Called<T> =
  { ok: true; data: T } | { ok: false; errorClass: ErrorClass; state: string };

/** The part of the adapter caller that the forge file step needs. */
export interface FileCaller {
  run<T>(command: string[], schema: z.ZodType<T>): Promise<Called<T>>;
}

export interface FileStepContext {
  db: Database;
  startedAt: Date;
  full: boolean;
  /** True for a fetch that a refresh request started. */
  refresh: boolean;
}

type FileRow = typeof schema.workForgeFiles.$inferInsert;
type CachedFile = typeof schema.workForgeFiles.$inferSelect;

/** Files that fail with one of these states are not an error of the repo. */
const ABSENT_CLASSES: readonly ErrorClass[] = ["missing_file", "missing_ref"];

/** The paths that a parser turns into parsed fields: the repo config and the module files. */
const PARSED_PATHS: ReadonlySet<string> = new Set([
  REPO_CONFIG_PATH,
  ...MODULE_FILES.map((file) => file.path),
]);

/**
 * True when the forge file step runs for this repo: it has no earlier step, its last step ended
 * 60 minutes ago or more, the fetch is full, or a refresh request started it.
 */
export async function forgeFilesDue(ctx: FileStepContext, repoId: string): Promise<boolean> {
  if (ctx.full || ctx.refresh) return true;
  const [row] = await ctx.db
    .select({ endedAt: schema.workRepos.forgeFilesEndedAt })
    .from(schema.workRepos)
    .where(eq(schema.workRepos.id, repoId));
  if (row?.endedAt == null) return true;
  return ctx.startedAt.getTime() - row.endedAt.getTime() >= FORGE_FILES_STALE_MS;
}

function absentRow(base: FileRow, errorClass: ErrorClass): FileRow {
  return { ...base, ref: null, sha: null, size: null, state: errorClass, errorClass, fields: null };
}

function moduleOffRow(base: FileRow): FileRow {
  return {
    ...base,
    ref: null,
    sha: null,
    size: null,
    state: "module_off",
    errorClass: null,
    fields: null,
  };
}

/** A failed file keeps its earlier parsed data and records its error class. */
function failedRow(base: FileRow, errorClass: ErrorClass, before: CachedFile | undefined): FileRow {
  return {
    ...base,
    ref: before?.ref ?? null,
    sha: before?.sha ?? null,
    size: before?.size ?? null,
    state: "failed",
    errorClass,
    skipped: before?.skipped ?? null,
    fields: before?.fields ?? null,
  };
}

interface ReadFile {
  row: FileRow;
  /** True when the call failed for a reason other than an absent file. */
  failed: boolean;
  /** The parsed repo config, for the repo config row only. */
  config: RepoConfigFields | null;
}

async function readFile(
  ctx: FileStepContext,
  caller: FileCaller,
  repoId: string,
  path: string,
  ref: string,
  before: CachedFile | undefined,
): Promise<ReadFile> {
  const base: FileRow = { repoId, path, fetchedAt: ctx.startedAt, state: "ok" };
  const result = await caller.run(["file", "get", path, "--ref", ref], contractSchemas.fileGet);
  if (!result.ok) {
    if (ABSENT_CLASSES.includes(result.errorClass)) {
      return { row: absentRow(base, result.errorClass), failed: false, config: null };
    }
    return { row: failedRow(base, result.errorClass, before), failed: true, config: null };
  }
  const { sha, size, content } = result.data;
  const common = { ...base, ref, sha, size, errorClass: null, skipped: null };
  if (
    before?.state === "ok" &&
    before.sha === sha &&
    before.ref === ref &&
    (before.fields !== null || !PARSED_PATHS.has(path))
  ) {
    return {
      row: { ...common, state: "ok", fields: before.fields, skipped: before.skipped },
      failed: false,
      config: repoConfigFromFields(path, before.fields),
    };
  }
  if (path !== REPO_CONFIG_PATH) {
    const module = parseModuleFile(path, content);
    if (module === null) {
      return { row: { ...common, state: "ok", fields: null }, failed: false, config: null };
    }
    if (!module.ok) {
      return {
        row: { ...common, state: "not_readable", fields: null },
        failed: false,
        config: null,
      };
    }
    return {
      row: {
        ...common,
        state: "ok",
        fields: moduleFileFieldsSchema.parse(module.fields),
        skipped: skippedEntriesSchema.parse(module.skipped),
      },
      failed: false,
      config: null,
    };
  }
  const parsed = parseRepoConfig(content);
  if (!parsed.ok) {
    return { row: { ...common, state: "not_readable", fields: null }, failed: false, config: null };
  }
  return {
    row: { ...common, state: "ok", fields: repoConfigFieldsSchema.parse(parsed.fields) },
    failed: false,
    config: parsed.fields,
  };
}

function repoConfigFromFields(path: string, fields: unknown): RepoConfigFields | null {
  if (path !== REPO_CONFIG_PATH) return null;
  const parsed = repoConfigFieldsSchema.safeParse(fields);
  return parsed.success ? parsed.data : null;
}

const NONE_CONFIG: RepoConfigFields = {
  mainBranch: null,
  controls: { state: "none" },
  releases: null,
};

/**
 * The forge file step of one repo: `repo`, then the repo config at the default branch, then the
 * module files at the file branch. It returns the first error class of a call that failed, or null.
 * A step that cannot read a file keeps the earlier row of that file.
 */
export async function runForgeFileStep(
  ctx: FileStepContext,
  caller: FileCaller,
  repoId: string,
): Promise<string | null> {
  const repoInfo = await caller.run(["repo"], contractSchemas.repoInfo);
  if (!repoInfo.ok) {
    await ctx.db
      .update(schema.workRepos)
      .set({
        repoState: "failed",
        repoErrorClass: repoInfo.errorClass,
        forgeFilesEndedAt: ctx.startedAt,
      })
      .where(eq(schema.workRepos.id, repoId));
    return repoInfo.errorClass;
  }
  const defaultBranch = usableDefaultBranch(repoInfo.data.default_branch);
  if (defaultBranch === null) {
    await ctx.db
      .update(schema.workRepos)
      .set({
        defaultBranch: null,
        fileBranch: null,
        repoState: "no_default_branch",
        repoErrorClass: null,
        forgeFilesEndedAt: ctx.startedAt,
      })
      .where(eq(schema.workRepos.id, repoId));
    return null;
  }

  const cachedRows = await ctx.db
    .select()
    .from(schema.workForgeFiles)
    .where(eq(schema.workForgeFiles.repoId, repoId));
  const cached = new Map(cachedRows.map((row) => [row.path, row]));

  const rows: FileRow[] = [];
  let firstError: string | null = null;
  const note = (read: ReadFile) => {
    rows.push(read.row);
    if (read.failed) firstError ??= read.row.errorClass ?? "other";
  };

  const configRead = await readFile(
    ctx,
    caller,
    repoId,
    REPO_CONFIG_PATH,
    defaultBranch,
    cached.get(REPO_CONFIG_PATH),
  );
  note(configRead);

  // The config decides the file branch and which module files to read.
  let config = configRead.config;
  const configAbsent =
    configRead.row.state === "missing_file" || configRead.row.state === "missing_ref";
  if (configAbsent) config = NONE_CONFIG;
  const fileBranch = fileBranchFor(defaultBranch, config?.mainBranch ?? null);

  const base = { repoId, fetchedAt: ctx.startedAt, state: "ok" };
  if (config !== null && config.controls.state !== "not_valid") {
    const toRead = new Set(filesToRead(config).map((file) => file.path));
    for (const file of MODULE_FILES) {
      if (toRead.has(file.path)) {
        note(await readFile(ctx, caller, repoId, file.path, fileBranch, cached.get(file.path)));
      } else {
        rows.push(moduleOffRow({ ...base, path: file.path }));
      }
    }
  }

  await ctx.db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(schema.workForgeFiles)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.workForgeFiles.repoId, schema.workForgeFiles.path],
          set: {
            ref: row.ref ?? null,
            sha: row.sha ?? null,
            size: row.size ?? null,
            fetchedAt: row.fetchedAt,
            state: row.state,
            errorClass: row.errorClass ?? null,
            skipped: row.skipped ?? null,
            fields: row.fields ?? null,
          },
        });
    }
    await tx
      .update(schema.workRepos)
      .set({
        defaultBranch,
        // A config that failed to load keeps the file branch of the last good step.
        ...(configRead.failed ? {} : { fileBranch }),
        repoState: "ok",
        repoErrorClass: null,
        forgeFilesEndedAt: ctx.startedAt,
      })
      .where(eq(schema.workRepos.id, repoId));
  });
  return firstError;
}
