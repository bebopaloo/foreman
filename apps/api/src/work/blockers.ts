import { schema, type Database } from "@foreman/db";
import type { WorkBlocker } from "@foreman/shared";
import { inArray } from "drizzle-orm";
import { linkFor } from "./lists.ts";
import type { ScopedRepo } from "./scope.ts";

export interface BlockersRepo extends ScopedRepo {
  /** `owner/name`. */
  fullName: string;
}

interface IssueRow {
  number: number;
  title: string;
  state: string;
  issueState: string;
  labels: string[];
  link: string | null;
  blockedBy: number[];
}

const CLOSED_STATES = new Set(["DONE", "CANCELLED"]);
const isOpen = (issue: Pick<IssueRow, "state" | "issueState">): boolean =>
  issue.state === "open" && !CLOSED_STATES.has(issue.issueState);

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The blockers of one repo. A blocker is an open issue that blocks at least one open issue.
 * `cutsOff` holds the open issues that it reaches through `blocked_by` links; a cycle stops at
 * an issue that the walk has seen, and an issue never cuts off itself.
 */
export function blockersOfRepo(repo: BlockersRepo, issues: readonly IssueRow[]): WorkBlocker[] {
  const open = new Map(issues.filter(isOpen).map((issue) => [issue.number, issue]));
  const dependents = new Map<number, Set<number>>();
  for (const issue of open.values()) {
    for (const blocker of issue.blockedBy) {
      if (blocker === issue.number || !open.has(blocker)) continue;
      const set = dependents.get(blocker) ?? new Set<number>();
      set.add(issue.number);
      dependents.set(blocker, set);
    }
  }
  const result: WorkBlocker[] = [];
  for (const [number, direct] of dependents) {
    const issue = open.get(number);
    if (issue === undefined) continue;
    const seen = new Set<number>([number]);
    const stack = [...direct];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      stack.push(...(dependents.get(next) ?? []));
    }
    seen.delete(number);
    result.push({
      repoId: repo.id,
      repo: repo.fullName,
      number,
      title: issue.title,
      issueState: issue.issueState,
      labels: issue.labels,
      link: linkFor(issue.link, repo),
      direct: [...direct].sort((a, b) => a - b),
      cutsOff: [...seen].sort((a, b) => a - b),
    });
  }
  return result;
}

const rank = (blocker: WorkBlocker): number =>
  blocker.issueState === "BLOCKED" ? 0 : blocker.labels.includes("attended-only") ? 1 : 2;

/** BLOCKED first, then `attended-only`, then the number of cut-off issues from high to low. */
export function compareBlockers(a: WorkBlocker, b: WorkBlocker): number {
  return (
    rank(a) - rank(b) ||
    b.cutsOff.length - a.cutsOff.length ||
    byText(a.repo, b.repo) ||
    a.number - b.number
  );
}

export async function listBlockers(
  db: Database,
  repos: readonly BlockersRepo[],
  limit: number | undefined,
): Promise<{ total: number; items: WorkBlocker[] }> {
  if (repos.length === 0) return { total: 0, items: [] };
  const rows = await db
    .select({
      repoId: schema.workIssues.repoId,
      number: schema.workIssues.number,
      title: schema.workIssues.title,
      state: schema.workIssues.state,
      issueState: schema.workIssues.issueState,
      labels: schema.workIssues.labels,
      link: schema.workIssues.link,
      blockedBy: schema.workIssues.blockedBy,
    })
    .from(schema.workIssues)
    .where(
      inArray(
        schema.workIssues.repoId,
        repos.map((repo) => repo.id),
      ),
    );
  const all = repos
    .flatMap((repo) =>
      blockersOfRepo(
        repo,
        rows.filter((row) => row.repoId === repo.id),
      ),
    )
    .sort(compareBlockers);
  return { total: all.length, items: limit === undefined ? all : all.slice(0, limit) };
}
