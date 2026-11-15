import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectRef {
  /** The path of the main checkout, or the folder path outside a repo. */
  key: string;
  /** True when the folder exists and git does not see a repo there. */
  noRepo: boolean;
}

// Group 1 is the path before a `.claude/worktrees/<name>` or `.worktrees/<name>` part.
// Group 2 is the repo folder path of a sibling `<repo folder>.worktrees/<name>` part.
// The repo folder name must not be empty, so `.worktrees` alone is not a sibling part.
const WORKTREE_PART =
  /^(?:(.*?)\/(?:\.claude\/worktrees|\.worktrees)|(.*?\/[^/]+)\.worktrees)\/[^/]+(?:\/.*)?$/;

const WORKTREE_NAME = /(?:^|\/)(?:[^/]*\.worktrees|\.claude\/worktrees)\/([^/]+)/;

/** The worktree folder name of a working folder, or null when the path has no worktree part. */
export function worktreeName(cwd: string): string | null {
  return WORKTREE_NAME.exec(cwd)?.[1] ?? null;
}

async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** The main checkout of the repo that holds the folder, or null when git cannot read it. */
async function mainCheckout(folder: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { timeout: 10_000 },
    );
    const commonDir = stdout.trim();
    return commonDir === "" ? null : path.dirname(commonDir);
  } catch {
    return null;
  }
}

/**
 * Maps working folders to Projects by the Project rules. Git gives the main
 * checkout when the folder exists. Else the path rules apply with no git call.
 * The result does not depend on the order of `cwds`.
 */
export async function resolveProjects(
  cwds: readonly string[],
  knownKeys: readonly string[] = [],
): Promise<Map<string, ProjectRef>> {
  const result = new Map<string, ProjectRef>();
  const finalKeys = new Set(knownKeys);
  const byPath = new Map<string, string>();

  for (const cwd of new Set(cwds)) {
    if (await isFolder(cwd)) {
      const main = await mainCheckout(cwd);
      const ref = main === null ? { key: cwd, noRepo: true } : { key: main, noRepo: false };
      result.set(cwd, ref);
      finalKeys.add(ref.key);
    } else {
      const part = WORKTREE_PART.exec(cwd);
      byPath.set(cwd, part?.[1] ?? part?.[2] ?? cwd);
    }
  }

  // Shortest paths first, so that a key exists before the folders below it.
  const candidates = [...new Set(byPath.values())].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  const mapped = new Map<string, string>();
  for (const candidate of candidates) {
    let best: string | undefined;
    for (const key of finalKeys) {
      if (candidate.startsWith(`${key}/`) && (best === undefined || key.length > best.length)) {
        best = key;
      }
    }
    if (best === undefined) finalKeys.add(candidate);
    mapped.set(candidate, best ?? candidate);
  }
  for (const [cwd, candidate] of byPath) {
    result.set(cwd, { key: mapped.get(candidate) ?? candidate, noRepo: false });
  }
  return result;
}

/** The label of each Project: the folder name, with the parent folder when names are equal. */
export function labelProjects(projects: readonly ProjectRef[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { key } of projects) {
    const name = path.basename(key);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const { key, noRepo } of projects) {
    const name = path.basename(key);
    let label = name;
    if ((counts.get(name) ?? 0) > 1) label = `${name} (${path.basename(path.dirname(key))})`;
    labels.set(key, noRepo ? `${label} (no repo)` : label);
  }
  return labels;
}

/** The API identifies a Project by this ID, so that a path never goes into a URL. */
export function projectId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}
