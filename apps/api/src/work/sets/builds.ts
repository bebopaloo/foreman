import { repoResolver } from "../../dash/dash.ts";
import { runsInWindow, type Run } from "../../dash/runs.ts";
import type { SetEnv, SetRef, SetResult } from "./types.ts";

/**
 * The sets `builds` and `merged`: the builds of the run `run`, by the rules of the dash Gantt.
 * `builds` goes by start and `merged` (the builds with the result "merged") by end, then by repo
 * label and issue number from low to high. A build with no Work cache row stays a bare row.
 */
export function buildsSet(env: SetEnv, set: "builds" | "merged", run: string): SetResult {
  const { nightLog, lock, repoList, parents } = env.sources;
  // The night log is local: the builds show with no repo connected.
  const found: Run | undefined = runsInWindow({
    entries: nightLog.entries,
    repoOf: repoResolver(repoList),
    isParent: (repo, issue) => repo.id !== null && parents.has(`${repo.id}#${issue.toString()}`),
    scope: env.scope,
    lockRunId: lock.state === "held" && !lock.stale ? lock.runId : null,
    now: env.now,
  }).find((candidate) => candidate.runId === run);
  if (found === undefined) return { refs: [], events: null };

  const refs: SetRef[] = found.builds
    .filter((build) => set === "builds" || build.result === "merged")
    .map((build) => ({
      repoId: build.repo.id,
      repo: build.repo.label,
      client: build.repo.client,
      issue: build.issue,
      pull: null,
      context: {
        kind: "build",
        issue: build.issue,
        start: build.start.toISOString(),
        end: build.end.toISOString(),
        result: build.result,
      },
      key: [
        (set === "builds" ? build.start : build.end).getTime(),
        build.repo.label,
        -build.issue,
        build.repo.key,
        0,
      ],
    }));
  return { refs, events: null };
}
