import { PRIORITIES, WAITS_LIMIT, type WaitItem, type Waits } from "@foreman/shared";
import {
  isOpen,
  mergeReady,
  releasePullRequests,
  todoStep,
  waitsTotal,
  type CachedIssue,
  type CachedPullRequest,
} from "./pipeline.ts";

export const NO_NIGHT_LOG_REASON = "see the comment in the tracker";
const RELEASE_REASON = "Release to perform";
const MERGE_READY_REASON = "merge-ready, waits for G3";
const TODO_REASONS = { spec: "Spec and G1", issues: "G2", ready: "make it READY" } as const;

export interface WaitsInput {
  issues: readonly CachedIssue[];
  pulls: readonly CachedPullRequest[];
  /** `owner/name` by repo ID. */
  repoLabels: ReadonlyMap<string, string>;
  /** The reason of the newest night log line with `to` BLOCKED, by `<repo ID>#<issue>`. */
  blockedReasons: ReadonlyMap<string, string>;
}

const priorityRank = (priority: string): number => {
  const index = (PRIORITIES as readonly string[]).indexOf(priority);
  return index === -1 ? PRIORITIES.length : index;
};

interface Candidate {
  item: WaitItem;
  rank: number;
}

/** The order inside a group: priority (highest first), the number, then `owner/name`. */
const compare = (a: Candidate, b: Candidate): number =>
  a.rank - b.rank ||
  a.item.number - b.item.number ||
  (a.item.repo < b.item.repo ? -1 : a.item.repo > b.item.repo ? 1 : 0);

/** The first `WAITS_LIMIT` items that wait for the Operator, in the order of `factory-next`, and the total. */
export function waitsOf(input: WaitsInput): Waits {
  return {
    total: waitsTotal(input.issues, input.pulls),
    items: allWaitItems(input).slice(0, WAITS_LIMIT),
  };
}

/** Every item that waits for the Operator, in the order of `factory-next`. */
export function allWaitItems({
  issues,
  pulls,
  repoLabels,
  blockedReasons,
}: WaitsInput): WaitItem[] {
  const repoOf = (repoId: string): string => repoLabels.get(repoId) ?? repoId;
  const fromIssue = (
    issue: CachedIssue,
    kind: WaitItem["kind"],
    reason: string,
    source: WaitItem["source"],
  ): Candidate => ({
    rank: priorityRank(issue.priority),
    item: {
      kind,
      repoId: issue.repoId,
      repo: repoOf(issue.repoId),
      number: issue.number,
      title: issue.title,
      reason,
      source,
      link: issue.link,
    },
  });
  const open = issues.filter(isOpen);
  const blocked = open
    .filter((issue) => issue.issueState === "BLOCKED")
    .map((issue) => {
      const reason = blockedReasons.get(`${issue.repoId}#${issue.number.toString()}`);
      return reason === undefined
        ? fromIssue(issue, "blocked", NO_NIGHT_LOG_REASON, "tracker")
        : fromIssue(issue, "blocked", reason, "night log");
    });
  const release: Candidate[] = releasePullRequests(pulls).map((pull) => ({
    rank: 0,
    item: {
      kind: "release",
      repoId: pull.repoId,
      repo: repoOf(pull.repoId),
      number: pull.number,
      title: pull.title,
      reason: RELEASE_REASON,
      source: "forge",
      link: pull.link,
    },
  }));
  const merged = open
    .filter((issue) => issue.issueState === "IN REVIEW" && mergeReady(issue))
    .map((issue) => fromIssue(issue, "merge_ready", MERGE_READY_REASON, "tracker"));
  const todo = open.flatMap((issue) => {
    const step = issue.issueState === "TODO" ? todoStep(issue) : null;
    return step === null ? [] : [fromIssue(issue, "todo", TODO_REASONS[step], "tracker")];
  });
  return [blocked, release, merged, todo]
    .flatMap((group) => group.sort(compare))
    .map((candidate) => candidate.item);
}
