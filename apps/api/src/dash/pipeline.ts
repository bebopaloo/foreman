import type { PipelineCounts } from "@foreman/shared";
import { OK_STATE, PARTIAL_STATE } from "../work/fetch-repo.ts";

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

/** The states that a fetch writes when a role of a repo has cache rows: a clean fetch and a partial one. */
export const CONNECTED_STATES: readonly string[] = [OK_STATE, PARTIAL_STATE];

/** The one rule for a connected repo: its last fetch of the role did not fail. */
export function isConnectedState(state: string | null | undefined): boolean {
  return state != null && CONNECTED_STATES.includes(state);
}

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

/** The stages of the strip, from the first gate to the release. */
export const STAGES = [
  "spec",
  "issues",
  "ready",
  "inProgress",
  "inReview",
  "blocked",
  "done",
  "release",
] as const;
export type Stage = (typeof STAGES)[number];

export interface StageMembers {
  issues: CachedIssue[];
  /** The open pull requests into `production`. Only the stage `release` has any. */
  pulls: CachedPullRequest[];
}

/**
 * The items of one stage of the strip. Each stage other than DONE uses open issues only. The
 * counts of the strip and the rows of a stage set both come from here.
 */
export function stageMembers(
  stage: Stage,
  issues: readonly CachedIssue[],
  pulls: readonly CachedPullRequest[],
): StageMembers {
  const open = issues.filter(isOpen);
  const inState = (issueState: string): CachedIssue[] =>
    open.filter((issue) => issue.issueState === issueState);
  const todoAt = (step: "spec" | "issues"): CachedIssue[] =>
    // A TODO issue with spec-waived is in no stage: its next step is "make it READY".
    inState("TODO").filter((issue) => todoStep(issue) === step);
  const none: CachedPullRequest[] = [];
  switch (stage) {
    case "spec":
      return { issues: todoAt("spec"), pulls: none };
    case "issues":
      return { issues: todoAt("issues"), pulls: none };
    case "ready":
      return { issues: inState("READY"), pulls: none };
    case "inProgress":
      return { issues: inState("IN PROGRESS"), pulls: none };
    case "inReview":
      return { issues: inState("IN REVIEW").filter((issue) => !mergeReady(issue)), pulls: none };
    case "blocked":
      return { issues: inState("BLOCKED"), pulls: none };
    case "done":
      return { issues: issues.filter((issue) => issue.issueState === "DONE"), pulls: none };
    case "release":
      return {
        issues: inState("IN REVIEW").filter(mergeReady),
        pulls: releasePullRequests(pulls),
      };
  }
}

/** The count of issues in each stage of the strip. */
export function pipelineCounts(
  issues: readonly CachedIssue[],
  pulls: readonly CachedPullRequest[],
): PipelineCounts {
  const size = (stage: Stage): number => {
    const members = stageMembers(stage, issues, pulls);
    return members.issues.length + members.pulls.length;
  };
  return {
    spec: size("spec"),
    issues: size("issues"),
    ready: size("ready"),
    inProgress: size("inProgress"),
    inReview: size("inReview"),
    blocked: size("blocked"),
    done: size("done"),
    release: size("release"),
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
