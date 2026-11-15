import type { PipelineCounts } from "@foreman/shared";

/** The most builds that the factory runs at one time. */
export const BUILD_SLOTS = 5;

export interface CachedIssue {
  repoId: string;
  number: number;
  title: string;
  priority: string;
  link: string | null;
  state: string;
  issueState: string;
  labels: readonly string[];
  hasChildren: boolean;
}

export interface CachedPullRequest {
  repoId: string;
  number: number;
  title: string;
  link: string | null;
  state: string;
  baseBranch: string;
}

const PRODUCTION = "production";

export const isOpen = (issue: CachedIssue): boolean => issue.state === "open";
export const mergeReady = (issue: CachedIssue): boolean => issue.labels.includes("merge-ready");
export const releasePullRequests = (pulls: readonly CachedPullRequest[]): CachedPullRequest[] =>
  pulls.filter((pull) => pull.state === "open" && pull.baseBranch === PRODUCTION);

/** The gate step of an open TODO issue, from the first rule that applies. Null is no stage. */
export function todoStep(issue: CachedIssue): "spec" | "issues" | "ready" | null {
  if (issue.labels.includes("finding") || issue.labels.includes("issues-approved")) return null;
  if (issue.labels.includes("spec-waived")) return "ready";
  return issue.labels.includes("spec-approved") ? "issues" : "spec";
}

/** The count of issues in each stage of the strip. Each stage other than DONE uses open issues only. */
export function pipelineCounts(
  issues: readonly CachedIssue[],
  pulls: readonly CachedPullRequest[],
): PipelineCounts {
  const open = issues.filter(isOpen);
  const inState = (issueState: string): number =>
    open.filter((issue) => issue.issueState === issueState).length;
  const todo = open.filter((issue) => issue.issueState === "TODO");
  const inReview = open.filter((issue) => issue.issueState === "IN REVIEW");
  return {
    // A TODO issue with spec-waived is in no stage: its next step is "make it READY".
    spec: todo.filter((issue) => todoStep(issue) === "spec").length,
    issues: todo.filter((issue) => todoStep(issue) === "issues").length,
    ready: inState("READY"),
    inProgress: inState("IN PROGRESS"),
    inReview: inReview.filter((issue) => !mergeReady(issue)).length,
    blocked: inState("BLOCKED"),
    done: issues.filter((issue) => issue.issueState === "DONE").length,
    release: inReview.filter(mergeReady).length + releasePullRequests(pulls).length,
  };
}

/** The count of items that wait for the Operator: the total of Waits for you. */
export function waitsTotal(
  issues: readonly CachedIssue[],
  pulls: readonly CachedPullRequest[],
): number {
  const open = issues.filter(isOpen);
  const blocked = open.filter((issue) => issue.issueState === "BLOCKED").length;
  const merged = open.filter((issue) => issue.issueState === "IN REVIEW" && mergeReady(issue));
  const todo = open.filter(
    (issue) => issue.issueState === "TODO" && todoStep(issue) !== null,
  ).length;
  // todoStep returns null for `finding` and `issues-approved`. `spec-waived` has the step "make it READY".
  return blocked + releasePullRequests(pulls).length + merged.length + todo;
}

/** The open issues in IN PROGRESS, or in IN REVIEW without `merge-ready`, that have no children. */
export function runningBuilds(
  issues: readonly CachedIssue[],
  enabledRepos: ReadonlySet<string>,
): number {
  return issues.filter(
    (issue) =>
      isOpen(issue) &&
      enabledRepos.has(issue.repoId) &&
      !issue.hasChildren &&
      (issue.issueState === "IN PROGRESS" ||
        (issue.issueState === "IN REVIEW" && !mergeReady(issue))),
  ).length;
}
