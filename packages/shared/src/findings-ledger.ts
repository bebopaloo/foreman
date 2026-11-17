import { z } from "zod";
import { ClientName } from "./client.ts";
import { pageQueryShape } from "./paging.ts";

const count = z.number().int().min(0);

export const FINDING_SEVERITIES = ["blocker", "major", "minor", "info"] as const;
export const FindingSeverity = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FINDING_STATUSES = ["verified", "refuted", "dropped"] as const;
export const FindingStatus = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const FINDING_OUTCOMES = ["open", "fixed", "disagreed", "deferred", "waived"] as const;
export const FindingOutcome = z.enum(FINDING_OUTCOMES);
export type FindingOutcome = z.infer<typeof FindingOutcome>;

/** The pass of the findings that the roll-up counts. */
export const SECURITY_PASS = "Security";

/** The columns of the security roll-up. A refuted finding counts as refuted, whatever its outcome. */
export const ROLLUP_COLUMNS = [
  "open",
  "fixed",
  "refuted",
  "deferred",
  "waived",
  "disagreed",
] as const;
export type RollupColumn = (typeof ROLLUP_COLUMNS)[number];

export const FINDINGS_PAGE = { defaultLimit: 50, maxLimit: 200 };

/**
 * `GET /api/reviews/findings`. `repo` is `owner/name`. `outcome` may be `none` for a finding with
 * no outcome.
 */
export const FindingsQuery = z
  .object({
    client: ClientName.optional(),
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .max(200)
      .optional(),
    pass: z.string().min(1).max(60).optional(),
    severity: FindingSeverity.optional(),
    status: FindingStatus.optional(),
    outcome: z.enum([...FINDING_OUTCOMES, "none"]).optional(),
    ...pageQueryShape(FINDINGS_PAGE),
  })
  .strict();
export type FindingsQuery = z.infer<typeof FindingsQuery>;

export const Finding = z
  .object({
    fingerprint: z.string(),
    /** `owner/name`. */
    repo: z.string(),
    pr: z.number().int().positive(),
    issue: z.number().int().positive().nullable(),
    /** The round in which the factory first saw the finding. */
    round: z.number().int().min(1),
    pass: z.string(),
    category: z.string(),
    severity: FindingSeverity,
    status: FindingStatus,
    outcome: FindingOutcome.nullable(),
    file: z.string().nullable(),
    line: z.number().int().nullable(),
    thread: z.string().nullable(),
    /** The time of the latest line of the fingerprint, as an ISO time. */
    time: z.string(),
    /** The link of the pull request in the forge. Null when the Work cache has no link. */
    link: z.string().nullable(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

const RollupRow = z
  .object({
    open: count,
    fixed: count,
    refuted: count,
    deferred: count,
    waived: count,
    disagreed: count,
    total: count,
  })
  .strict();

export const FindingsResponse = z
  .object({
    /** The state of the ledger folder. */
    folder: z.enum(["ok", "missing", "unreadable"]),
    skippedLines: count,
    skippedFiles: count,
    /** The Security pass in scope, by severity. It ignores the severity, status and outcome filters. */
    security: z.object({ bySeverity: z.record(FindingSeverity, RollupRow) }).strict(),
    /** The repos and the passes in scope, for the filter lists. */
    repos: z.array(z.string()),
    passes: z.array(z.string()),
    /** The count of findings after the filters. */
    total: count,
    items: z.array(Finding),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type FindingsResponse = z.infer<typeof FindingsResponse>;
