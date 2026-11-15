import { z } from "zod";
import { ClientName } from "./client.ts";
import { pageQueryShape } from "./paging.ts";

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

const RepoId = z.string().regex(/^[0-9a-f]{12}$/);

export const WorkItemsQuery = z
  .object({
    client: ClientName.optional(),
    repo: RepoId.optional(),
    issue_state: z.enum([...ISSUE_STATES, "none"]).optional(),
    type: z.enum([...ISSUE_TYPES, "multiple", "none"]).optional(),
    priority: z.enum([...PRIORITIES, "none"]).optional(),
    sort: z.enum(WORK_ITEMS_SORTS).default("repo"),
    ...pageQueryShape({ defaultLimit: 100, maxLimit: 500 }),
  })
  .strict();
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

export const WorkItem = z
  .object({
    repoId: RepoId,
    fullName: z.string(),
    client: z.string().nullable(),
    issue: WorkItemIssue.nullable(),
    pullRequest: WorkItemPullRequest.nullable(),
    machineGate: WorkItemGate.nullable(),
    round: z.number().int().min(1).max(3).nullable(),
    riskTier: z.enum(RISK_TIERS).nullable(),
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
  })
  .strict();
export type WorkItemsResponse = z.infer<typeof WorkItemsResponse>;
