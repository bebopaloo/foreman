import { schema, type Database } from "@foreman/db";
import { eq } from "drizzle-orm";
import { isRef } from "../work/runner.ts";
import {
  MODULE_FILES,
  REPO_CONFIG_PATH,
  repoConfigFieldsSchema,
  type ModuleFile,
  type RepoConfigFields,
} from "./files.ts";

/** The default branch when it passes the ref rule of the runner, else null ("no default branch"). */
export function usableDefaultBranch(value: string): string | null {
  return value !== "" && isRef(value) ? value : null;
}

/** The file branch: `main_branch` when it passes the ref rule, else the default branch. */
export function fileBranchFor(defaultBranch: string, mainBranch: string | null): string {
  return mainBranch !== null && isRef(mainBranch) ? mainBranch : defaultBranch;
}

/** The Control modules that are on. No `controls` key and a key that is not valid both give none. */
export function modulesOn(fields: RepoConfigFields): readonly string[] {
  return fields.controls.state === "ok" ? fields.controls.modules : [];
}

/** The module files whose module is on. */
export function filesToRead(fields: RepoConfigFields): ModuleFile[] {
  const on = modulesOn(fields);
  return MODULE_FILES.filter((file) => on.includes(file.module));
}

export interface ControlModulesRow {
  repoId: string;
  defaultBranch: string | null;
  fileBranch: string | null;
  /** The state of the last `repo` call. */
  repoState: string | null;
  /** The state of the repo config row, or null when no step read it. */
  configState: string | null;
  config: RepoConfigFields | null;
  profile: string;
  modules: readonly string[];
  controlEvents: boolean;
}

/** The default branch, the file branch, the Control modules and the `releases` key of each repo, from the cache. */
export async function readControlModules(db: Database): Promise<ControlModulesRow[]> {
  const repos = await db
    .select({
      id: schema.workRepos.id,
      defaultBranch: schema.workRepos.defaultBranch,
      fileBranch: schema.workRepos.fileBranch,
      repoState: schema.workRepos.repoState,
    })
    .from(schema.workRepos);
  const configs = await db
    .select({
      repoId: schema.workForgeFiles.repoId,
      state: schema.workForgeFiles.state,
      fields: schema.workForgeFiles.fields,
    })
    .from(schema.workForgeFiles)
    .where(eq(schema.workForgeFiles.path, REPO_CONFIG_PATH));
  const byRepo = new Map(configs.map((row) => [row.repoId, row]));
  return repos
    .map((repo) => {
      const stored = byRepo.get(repo.id);
      const parsed = repoConfigFieldsSchema.safeParse(stored?.fields);
      const config = parsed.success ? parsed.data : null;
      const modules = config === null ? [] : modulesOn(config);
      return {
        repoId: repo.id,
        defaultBranch: repo.defaultBranch,
        fileBranch: repo.fileBranch,
        repoState: repo.repoState,
        configState: stored?.state ?? null,
        config,
        profile: config?.controls.state === "ok" ? config.controls.profile : "none",
        modules,
        controlEvents: modules.includes("control_events"),
      };
    })
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
}
