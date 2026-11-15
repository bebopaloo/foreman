import { z } from "zod";

/** The strict shapes of the adapter output. An unknown key or a value outside its enum fails. */

export const RELEASE_TAG_PATTERN = /^(?:[a-z0-9][a-z0-9-]*-)?v\d+\.\d+\.\d+$/;

const number = z.number().int().positive();

const issueSchema = z
  .object({
    number,
    url: z.string(),
    title: z.string(),
    body: z.string(),
    state: z.enum(["open", "closed"]),
    labels: z.array(z.string()),
    author: z.string(),
    issue_state: z.string().min(1),
    priority: z.string().min(1),
  })
  .strict();

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const STATUS_CONTEXTS = ["factory/machine-gate", "factory/release-review"] as const;

const pullRequestSchema = z
  .object({
    number,
    url: z.string(),
    title: z.string(),
    state: z.enum(["open", "closed", "merged"]),
    draft: z.boolean(),
    head: z.string(),
    base: z.string(),
    author: z.string(),
    checks: z.enum(["none", "pending", "success", "failure"]),
    labels: z.array(z.string()),
    head_sha: z.string().regex(SHA_PATTERN).optional(),
  })
  .strict();

/** The output of `status get`. The runner also checks that `sha` and `context` match the request. */
const commitStatusSchema = z
  .object({
    sha: z.string().regex(SHA_PATTERN),
    context: z.enum(STATUS_CONTEXTS),
    state: z.enum(["pass", "fail", "pending", "none"]),
    description: z.string(),
  })
  .strict();

const relationsSchema = z
  .object({
    number,
    parent: number.nullable(),
    children: z.array(number),
    blocked_by: z.array(number),
  })
  .strict();

const trackerReleaseSchema = z
  .object({
    name: z.string().min(1),
    url: z.string(),
    state: z.enum(["open", "released"]),
    issues: z.array(number),
  })
  .strict();

/** One review. A review that fails this shape is skipped; it does not fail the whole list. */
export const prReviewSchema = z
  .object({
    author: z.string(),
    state: z.string().min(1),
    commit: z.string().min(1),
    body: z.string(),
    time: z.string().min(1),
  })
  .strict();

const forgeReleaseSchema = z
  .object({
    tag: z.string().regex(RELEASE_TAG_PATTERN),
    url: z.string(),
    target: z.string().min(1),
    assets: z.array(z.string()),
  })
  .strict();

export const contractSchemas = {
  issueList: z.array(issueSchema),
  issueRelations: relationsSchema,
  releaseList: z.array(trackerReleaseSchema),
  prList: z.array(pullRequestSchema).refine(
    // An older adapter sends no head_sha at all. A list that mixes both is a broken contract.
    (list) =>
      list.every((item) => item.head_sha !== undefined) ||
      list.every((item) => item.head_sha === undefined),
  ),
  commitStatus: commitStatusSchema,
  prReviews: z.array(z.unknown()),
  releaseView: forgeReleaseSchema,
};

export type ContractName = keyof typeof contractSchemas;
