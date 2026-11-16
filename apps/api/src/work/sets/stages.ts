import { PRIORITIES, type STAGE_SETS } from "@foreman/shared";
import { connectedWork } from "../../dash/dash.ts";
import { stageMembers, type Stage } from "../../dash/pipeline.ts";
import type { SetEnv, SetRef, SetResult } from "./types.ts";

export type StageSetName = (typeof STAGE_SETS)[number];

const STAGE_OF: Record<StageSetName, Stage> = {
  stage_g1: "spec",
  stage_g2: "issues",
  stage_ready: "ready",
  stage_in_progress: "inProgress",
  stage_in_review: "inReview",
  stage_blocked: "blocked",
  stage_done: "done",
  stage_g3: "release",
};

const priorityRank = (priority: string): number => {
  const index = (PRIORITIES as readonly string[]).indexOf(priority);
  return index === -1 ? PRIORITIES.length : index;
};

/**
 * The rows of one stage of the strip, from the same rule as its dash count. Issues come by
 * priority, `owner/name` and number from high to low; DONE has no priority order. The pull
 * requests of G3 come first, by number from high to low.
 */
export function stageSet(env: SetEnv, set: StageSetName): SetResult {
  const stage = STAGE_OF[set];
  const { connected, issues, pulls, repoLabels } = connectedWork(env.sources, env.scope);
  const clients = new Map(connected.map((entry) => [entry.id, entry.client]));
  const label = (repoId: string): string => repoLabels.get(repoId) ?? repoId;
  const members = stageMembers(stage, issues, pulls);
  const byPull: SetRef[] = members.pulls.map((pull) => ({
    repoId: pull.repoId,
    repo: label(pull.repoId),
    client: clients.get(pull.repoId) ?? null,
    issue: null,
    pull: pull.number,
    context: null,
    key: [0, "", pull.number, pull.repoId, 1],
  }));
  const byIssue: SetRef[] = members.issues.map((issue) => ({
    repoId: issue.repoId,
    repo: label(issue.repoId),
    client: clients.get(issue.repoId) ?? null,
    issue: issue.number,
    pull: null,
    context: null,
    key: [
      stage === "done" ? 0 : 1 + priorityRank(issue.priority),
      label(issue.repoId),
      issue.number,
      issue.repoId,
      0,
    ],
  }));
  return { refs: [...byPull, ...byIssue], events: null };
}
