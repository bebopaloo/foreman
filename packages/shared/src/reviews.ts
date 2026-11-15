import { z } from "zod";
import { ClientName } from "./client.ts";
import { pageQueryShape } from "./paging.ts";
import { RISK_TIERS } from "./work.ts";

const count = z.number().int().min(0);
const percent = z.number().int().min(0).max(100);
const RepoId = z.string().regex(/^[0-9a-f]{12}$/);
const Tier = z.enum(RISK_TIERS);

export const REVIEWS_MODES = ["round1", "settle"] as const;
export const ReviewsMode = z.enum(REVIEWS_MODES);
export type ReviewsMode = z.infer<typeof ReviewsMode>;

export const REVIEWS_PAGE = { defaultLimit: 50, maxLimit: 200 };

/** `GET /api/reviews`. `mode` chooses the findings events: round 1 or the settle. */
export const ReviewsQuery = z
  .object({ client: ClientName.optional(), mode: ReviewsMode.default("round1") })
  .strict();
export type ReviewsQuery = z.infer<typeof ReviewsQuery>;

/** `GET /api/reviews/pull-requests`. `tier` is a Risk tier or `none` for the pull requests with no tier. */
export const ReviewsPullRequestsQuery = z
  .object({
    client: ClientName.optional(),
    repo: RepoId.optional(),
    tier: z.enum([...RISK_TIERS, "none"]).optional(),
    ...pageQueryShape(REVIEWS_PAGE),
  })
  .strict();
export type ReviewsPullRequestsQuery = z.infer<typeof ReviewsPullRequestsQuery>;

const TierCounts = z
  .object({
    authority: count,
    sensitive: count,
    general: count,
    inert: count,
    none: count,
  })
  .strict();

const Tiles = z
  .object({
    pullRequestsReviewed: z.object({ count }).strict(),
    /** The rate of the dash. Null with no `gate` decision of round 1 in 30 days. */
    firstRoundPass: z.object({ percent: percent.nullable(), passed: count, total: count }).strict(),
    /** Escalated pull requests over the pull requests with a final tier. Null with no tier. */
    escalationRate: z
      .object({ percent: percent.nullable(), escalated: count, withTier: count })
      .strict(),
    /** Review cycles over build times and Review cycles of the builds timed from an Agent span. */
    reviewShare: z.object({ percent: percent.nullable(), builds: count }).strict(),
  })
  .strict();

const TierResults = z
  .object({
    byFinalTier: TierCounts,
    pathAgainstFinal: z
      .object({
        /** The 16 cells: path tiers as rows and final tiers as columns, from `authority` to `inert`. */
        cells: z.array(
          z.object({ pathTier: Tier, finalTier: Tier, count, escalated: z.boolean() }).strict(),
        ),
        noTier: count,
      })
      .strict(),
    merges: z.array(
      z
        .object({
          /** `feature/*` for every base that starts with `feature/`. */
          base: z.string(),
          authority: count,
          sensitive: count,
          general: count,
          inert: count,
          none: count,
        })
        .strict(),
    ),
  })
  .strict();

const RoundsRow = z
  .object({
    /** Null for the pull requests with no tier. */
    tier: Tier.nullable(),
    pullRequests: count,
    settledInRound: z.tuple([count, count, count]),
    blocked: count,
    notSettled: count,
    withDecision: count,
    lastGatePassPercent: percent.nullable(),
  })
  .strict();

const SeverityRow = z
  .object({
    authority: count.optional(),
    sensitive: count.optional(),
    general: count.optional(),
    inert: count.optional(),
    none: count.optional(),
    total: count,
  })
  .strict();

const NamedCount = z.object({ name: z.string(), count }).strict();

const Findings = z
  .object({
    mode: ReviewsMode,
    security: z
      .object({
        bySeverity: z
          .object({
            blocker: SeverityRow,
            major: SeverityRow,
            minor: SeverityRow,
            info: SeverityRow,
          })
          .strict(),
        withoutMatrix: count,
      })
      .strict(),
    byCategory: z.array(NamedCount),
    bySeverity: z.array(NamedCount),
    refs: z.array(z.object({ ref: z.string(), pullRequests: count }).strict()),
    refsMore: count,
    signals: z.array(
      z
        .object({
          repoId: RepoId.nullable(),
          repo: z.string(),
          pr: z.number().int().positive(),
          tier: z.enum(["general", "inert"]),
          blocker: count,
          major: count,
          minor: count,
          link: z.string().nullable(),
        })
        .strict(),
    ),
    signalsMore: count,
  })
  .strict();

const Times = z
  .object({
    byTier: z.array(
      z
        .object({
          tier: Tier.nullable(),
          pullRequests: count,
          /** The rows that the medians and the share use. */
          timed: count,
          medianBuildSeconds: count.nullable(),
          medianReviewCycleSeconds: count.nullable(),
          meanRounds: z.number().min(0).nullable(),
          reviewSharePercent: percent.nullable(),
        })
        .strict(),
    ),
    noBuildEnd: count,
    notTimed: count,
    noPullRequest: count,
    reviewAgentSpansNotLinked: count,
    /** The "data as of" time of the Usage index. Null while no Agent span is read. */
    usageDataAsOf: z.iso.datetime().nullable(),
  })
  .strict();

const EventsOff = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    /** `module_off`: the cached repo config does not list `control_events`. `no_events`: no Control event in 30 days. */
    reason: z.enum(["module_off", "no_events"]),
    /** Null when no Factory identity login is set, or when the Work cache has no counts for the repo. */
    reviewed: count.nullable(),
    unreviewed: count.nullable(),
  })
  .strict();

export const ReviewsResponse = z
  .object({
    tiles: Tiles,
    tierResults: TierResults,
    rounds: z.array(RoundsRow),
    findings: Findings,
    times: Times,
    factoryLoginSet: z.boolean(),
    eventsOff: z.array(EventsOff),
    skipped: z.object({ nightLogLines: count, controlEvents: count, files: count }).strict(),
    /** The count of repos in scope with no cache rows or a fetch error. */
    complete: count,
    state: z.enum(["ok", "not_connected"]),
  })
  .strict();
export type ReviewsResponse = z.infer<typeof ReviewsResponse>;

export const REVIEW_BUILD_END_SOURCES = ["agent span", "first gate event"] as const;

export const ReviewsPullRequest = z
  .object({
    /** Null for a repo folder that is not in the repo list. */
    repoId: RepoId.nullable(),
    /** `owner/name`, or the last part of the repo folder. */
    repo: z.string(),
    number: z.number().int().positive(),
    issue: z.number().int().positive(),
    finalTier: Tier.nullable(),
    pathTier: Tier.nullable(),
    escalated: z.boolean(),
    /** Null with no `gate` event. */
    rounds: count.nullable(),
    /** Null with no `gate` event. */
    outcome: z.enum(["pass", "blocked", "not_settled"]).nullable(),
    /** Null with no build end. */
    buildSeconds: count.nullable(),
    buildEndSource: z.enum(REVIEW_BUILD_END_SOURCES).nullable(),
    reviewCycleSeconds: count.nullable(),
    /** The split of the Review cycle. Null with no linked Agent span. */
    split: z
      .object({ reviewAgentsSeconds: count, resolverSeconds: count, otherSeconds: count })
      .strict()
      .nullable(),
    totalSeconds: count,
    link: z.string().nullable(),
  })
  .strict();
export type ReviewsPullRequest = z.infer<typeof ReviewsPullRequest>;

export const ReviewsPullRequestsResponse = z
  .object({
    items: z.array(ReviewsPullRequest),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type ReviewsPullRequestsResponse = z.infer<typeof ReviewsPullRequestsResponse>;
