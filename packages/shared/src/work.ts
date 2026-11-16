import { z } from "zod";
import { ClientName } from "./client.ts";
import { pageQueryShape } from "./paging.ts";
import { BUILD_RESULTS, WAIT_KINDS } from "./dash.ts";

export const ISSUE_STATES = [
  "TODO",
  "READY",
  "IN PROGRESS",
  "IN REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const ISSUE_TYPES = ["feature", "fix", "chore"] as const;
export const PRIORITIES = ["highest", "high", "medium", "low"] as const;
/** From the highest tier to the lowest. */
export const RISK_TIERS = ["authority", "sensitive", "general", "inert"] as const;
export const GATE_FORGE_VALUES = ["pass", "fail", "pending", "none"] as const;
export const GATE_EVENT_VALUES = ["pass", "fail", "wait", "blocked"] as const;

export const WORK_ITEMS_SORTS = ["repo", "priority", "state"] as const;

/** The dash stage sets, in the order of the pipeline strip. */
export const STAGE_SETS = [
  "stage_g1",
  "stage_g2",
  "stage_ready",
  "stage_in_progress",
  "stage_in_review",
  "stage_blocked",
  "stage_done",
  "stage_g3",
] as const;
export const BUILD_SETS = ["builds", "merged"] as const;
export const TIER_SETS = [
  "tier_authority",
  "tier_sensitive",
  "tier_general",
  "tier_inert",
  "tier_none",
] as const;
export const ROUND_SETS = ["round_1", "round_2", "round_3"] as const;
export const REVIEW_SETS = [...TIER_SETS, ...ROUND_SETS, "escalated", "waivers"] as const;
/** Each `set` value of `GET /api/work/items`: the items behind one number of the dash. */
export const WORK_SETS = [...BUILD_SETS, "waits", ...STAGE_SETS, ...REVIEW_SETS] as const;
export const WorkSet = z.enum(WORK_SETS);
export type WorkSet = z.infer<typeof WorkSet>;

/** The heading of each set. The List panel and the Work view show it. */
export const SET_LABELS: Readonly<Record<WorkSet, string>> = {
  builds: "Builds in the last run",
  merged: "Merged in the last run",
  waits: "Waits for you",
  stage_g1: "G1 Spec",
  stage_g2: "G2 Issues",
  stage_ready: "READY",
  stage_in_progress: "IN PROGRESS",
  stage_in_review: "IN REVIEW",
  stage_blocked: "BLOCKED",
  stage_done: "DONE",
  stage_g3: "G3 Release",
  tier_authority: "First-round pass: authority",
  tier_sensitive: "First-round pass: sensitive",
  tier_general: "First-round pass: general",
  tier_inert: "First-round pass: inert",
  tier_none: "First-round pass: no tier",
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
  escalated: "Escalations",
  waivers: "Waivers in use",
};

export const RUN_ID_MAX = 200;

const RepoId = z.string().regex(/^[0-9a-f]{12}$/);

const filterShape = {
  repo: RepoId.optional(),
  issue_state: z.enum([...ISSUE_STATES, "none"]).optional(),
  type: z.enum([...ISSUE_TYPES, "multiple", "none"]).optional(),
  priority: z.enum([...PRIORITIES, "none"]).optional(),
};

/** The filters and the sort of the Work view, with the default sort. */
export const WorkItemsFilters = z
  .object({ ...filterShape, sort: z.enum(WORK_ITEMS_SORTS).default("repo") })
  .strict();
export type WorkItemsFilters = z.infer<typeof WorkItemsFilters>;

export const WorkItemsQuery = z
  .object({
    client: ClientName.optional(),
    ...filterShape,
    /** The route uses `repo` when it is not set. Not allowed with `set`. */
    sort: z.enum(WORK_ITEMS_SORTS).optional(),
    set: WorkSet.optional(),
    run: z.string().min(1).max(RUN_ID_MAX).optional(),
    ...pageQueryShape({ defaultLimit: 100, maxLimit: 500 }),
  })
  .strict()
  .superRefine((query, context) => {
    const reject = (path: string, message: string) => {
      context.addIssue({ code: "custom", path: [path], message });
    };
    const needsRun = query.set === "builds" || query.set === "merged";
    if (needsRun && query.run === undefined) reject("run", "run is required with this set");
    if (query.run !== undefined && !needsRun) {
      reject("run", "run is only for the sets builds and merged");
    }
    if (query.set === undefined) return;
    for (const name of ["repo", "issue_state", "type", "priority", "sort"] as const) {
      if (query[name] !== undefined) reject(name, "not allowed with set");
    }
  });
export type WorkItemsQuery = z.infer<typeof WorkItemsQuery>;

const WorkItemIssue = z
  .object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    issueState: z.string(),
    /** `multiple` for more than one `type:*` label, null for none. */
    type: z.enum([...ISSUE_TYPES, "multiple"]).nullable(),
    priority: z.enum([...PRIORITIES, "none"]),
    link: z.string().nullable(),
    stale: z.boolean(),
  })
  .strict();

const WorkItemPullRequest = z
  .object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    checks: z.string(),
    link: z.string().nullable(),
    stale: z.boolean(),
    /** The count of the other pull requests that link to the same issue. */
    otherCount: z.number().int().min(0),
  })
  .strict();

const WorkItemGate = z.discriminatedUnion("source", [
  z.object({ source: z.literal("forge"), value: z.enum(GATE_FORGE_VALUES) }).strict(),
  z.object({ source: z.literal("events"), value: z.enum(GATE_EVENT_VALUES) }).strict(),
]);

const WorkItemDecision = z.discriminatedUnion("type", [
  z.object({ type: z.literal("decision"), decision: z.enum(["pass", "fail"]) }).strict(),
  z.object({ type: z.literal("round"), round: z.number().int().min(1).max(3) }).strict(),
  z
    .object({
      type: z.literal("escalations"),
      /** The `escalated` events of the pull request, oldest first. */
      events: z.array(
        z.object({ pathTier: z.string().nullable(), finalTier: z.string().nullable() }).strict(),
      ),
    })
    .strict(),
  z.object({ type: z.literal("waivers"), ids: z.array(z.string()) }).strict(),
]);

/** The facts of a set that the row of an item does not hold. Null with no `set`, and in the stage sets. */
export const WorkItemContext = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("build"),
      issue: z.number().int().positive(),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      result: z.enum(BUILD_RESULTS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait"),
      wait: z.enum(WAIT_KINDS),
      reason: z.string(),
      source: z.enum(["night log", "tracker", "forge"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("review"),
      pullRequest: z.number().int().positive(),
      link: z.string().nullable(),
      detail: WorkItemDecision,
    })
    .strict(),
]);
export type WorkItemContext = z.infer<typeof WorkItemContext>;

export const WorkItem = z
  .object({
    /** Null for a build or a Control event of a repo that is not in the repo list. */
    repoId: RepoId.nullable(),
    fullName: z.string(),
    client: z.string().nullable(),
    issue: WorkItemIssue.nullable(),
    pullRequest: WorkItemPullRequest.nullable(),
    machineGate: WorkItemGate.nullable(),
    round: z.number().int().min(1).max(3).nullable(),
    riskTier: z.enum(RISK_TIERS).nullable(),
    context: WorkItemContext.nullable(),
  })
  .strict();
export type WorkItem = z.infer<typeof WorkItem>;

const count = z.number().int().min(0);

export const WorkItemsResponse = z
  .object({
    state: z.enum(["ok", "not_connected"]),
    items: z.array(WorkItem),
    nextCursor: z.string().min(1).nullable(),
    counts: z
      .object({
        all: count,
        TODO: count,
        READY: count,
        "IN PROGRESS": count,
        "IN REVIEW": count,
        BLOCKED: count,
        DONE: count,
        CANCELLED: count,
        none: count,
      })
      .strict(),
    /** The count of repos in scope with no cache rows or a fetch error. */
    complete: count,
    /** The IDs of the connected repos in scope with no Control event in the last 30 days. */
    noControlEvents: z.array(RepoId),
    skipped: z.object({ controlEvents: count, files: count }).strict(),
    /** The state of the two factory folders. Null with no `set`. */
    sources: z
      .object({
        runs: z.enum(["ok", "missing", "unreadable"]),
        controls: z.enum(["ok", "missing", "unreadable"]),
      })
      .strict()
      .nullable(),
    /** With `escalated`: the count of events. With `waivers`: the count of distinct Waivers. Else null. */
    events: count.nullable(),
  })
  .strict();
export type WorkItemsResponse = z.infer<typeof WorkItemsResponse>;
