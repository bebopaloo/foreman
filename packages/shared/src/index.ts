import { z } from "zod";
import { NextCursor, pageQueryShape, pageResponseSchema } from "./paging.ts";

export const HealthResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    version: z.string().min(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;

export const WorkClientsResponse = z
  .object({
    clients: z.array(z.object({ name: z.string(), repoCount: z.number().int() }).strict()),
    unassignedCount: z.number().int(),
  })
  .strict();

export type WorkClientsResponse = z.infer<typeof WorkClientsResponse>;

export const WorkReposResponse = z
  .object({
    repos: z.array(
      z
        .object({
          id: z.string(),
          fullName: z.string(),
          host: z.string(),
          client: z.string().nullable(),
          state: z.string().nullable(),
          dataAsOf: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type WorkReposResponse = z.infer<typeof WorkReposResponse>;

export const WorkStatusResponse = z
  .object({
    state: z.enum(["idle", "running", "failed"]),
    reason: z.string().nullable(),
    lastFetchStartedAt: z.string().nullable(),
    lastFetchAt: z.string().nullable(),
    lastFullFetchStartedAt: z.string().nullable(),
    lastFullFetchAt: z.string().nullable(),
    problems: z.array(z.object({ position: z.number().int(), field: z.string() }).strict()),
    owners: z.array(z.object({ host: z.string(), owner: z.string(), state: z.string() }).strict()),
    repos: z.array(
      z
        .object({
          id: z.string(),
          fullName: z.string(),
          forgeState: z.string().nullable(),
          forgeErrorClass: z.string().nullable(),
          trackerState: z.string().nullable(),
          trackerErrorClass: z.string().nullable(),
          dataAsOf: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type WorkStatusResponse = z.infer<typeof WorkStatusResponse>;

/** The shape of a client name in the repo list. */
export const ClientName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

export const ProjectsQuery = z
  .object({
    client: ClientName.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .strict();

export type ProjectsQuery = z.infer<typeof ProjectsQuery>;

export const UsageProject = z
  .object({
    id: z.string().regex(/^[0-9a-f]{12}$/),
    label: z.string().min(1),
    noRepo: z.boolean(),
    /** The client of the repo list entry whose `path` is the Project key, or null. */
    client: z.string().nullable(),
    firstTurnAt: z.iso.datetime(),
    lastTurnAt: z.iso.datetime(),
  })
  .strict();

export type UsageProject = z.infer<typeof UsageProject>;

export const ProjectsResponse = z.object({ projects: z.array(UsageProject) }).strict();

export type ProjectsResponse = z.infer<typeof ProjectsResponse>;

export const RefreshStatusResponse = z
  .object({
    state: z.enum(["idle", "running", "failed"]),
    filesRead: z.number().int().nullable(),
    filesTotal: z.number().int().nullable(),
    dataAsOf: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export type RefreshStatusResponse = z.infer<typeof RefreshStatusResponse>;

/** The most buckets that one series request may ask for. */
export const MAX_SERIES_BUCKETS = 3700;

// Only IANA names: Postgres reads an offset such as `+03:00` with the opposite sign.
const TIME_ZONES: ReadonlySet<string> = new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);

function isTimeZone(value: string): boolean {
  return TIME_ZONES.has(value);
}

const UsageDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Not a calendar date");

const rangeShape = {
  client: ClientName.optional(),
  from: UsageDate,
  to: UsageDate,
  tz: z.string().min(1).refine(isTimeZone, "Unknown time zone"),
  project: z
    .string()
    .regex(/^[0-9a-f]{12}$/)
    .optional(),
};

function fromNotAfterTo(value: { from: string; to: string }): boolean {
  return value.from <= value.to;
}

export const UsageGrain = z.enum(["day", "week", "month"]);
export type UsageGrain = z.infer<typeof UsageGrain>;

export const SeriesQuery = z
  .object({ ...rangeShape, grain: UsageGrain })
  .strict()
  .refine(fromNotAfterTo, "from is after to");
export type SeriesQuery = z.infer<typeof SeriesQuery>;

export const BREAKDOWN_DIMENSIONS = [
  "project",
  "model",
  "agentType",
  "branch",
  "session",
  "skill",
] as const;

export const BreakdownQuery = z
  .object({
    ...rangeShape,
    dimension: z.enum(BREAKDOWN_DIMENSIONS),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict()
  .refine(fromNotAfterTo, "from is after to");
export type BreakdownQuery = z.infer<typeof BreakdownQuery>;

const tokenCounts = {
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  turns: z.number().int(),
};

export const ESTIMATE_NOTE =
  "List-price estimate: what this usage costs at the public API prices. It is not what your subscription charges." as const;

/** The estimate in USD. It is null when the turns have no price. */
const estimateFields = {
  estimate: z.number().nonnegative().nullable(),
  unpricedTurns: z.number().int(),
};

const unpricedModels = z.array(z.object({ model: z.string(), turns: z.number().int() }).strict());

export const SeriesResponse = z
  .object({
    buckets: z.array(z.object({ start: UsageDate, ...tokenCounts, ...estimateFields }).strict()),
    unpricedModels,
    note: z.literal(ESTIMATE_NOTE),
  })
  .strict();
export type SeriesResponse = z.infer<typeof SeriesResponse>;

export const BreakdownResponse = z
  .object({
    rows: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          ...tokenCounts,
          ...estimateFields,
          firstTurnAt: z.iso.datetime().optional(),
          lastTurnAt: z.iso.datetime().optional(),
          // Project rows only.
          client: z.string().nullable().optional(),
          // Skill rows only.
          calls: z.number().int().optional(),
          exactTurns: z.number().int().optional(),
          estimatedTurns: z.number().int().optional(),
        })
        .strict(),
    ),
    totals: z.object({ ...tokenCounts, ...estimateFields }).strict(),
    rowCount: z.number().int(),
    unpricedModels,
    note: z.literal(ESTIMATE_NOTE),
  })
  .strict();
export type BreakdownResponse = z.infer<typeof BreakdownResponse>;

// No `client` here: a limit window belongs to the whole plan, and `.strict()` refuses the key.
export const LimitsQuery = z
  .object({
    from: UsageDate,
    to: UsageDate,
    tz: rangeShape.tz,
  })
  .strict()
  .refine(fromNotAfterTo, "from is after to");
export type LimitsQuery = z.infer<typeof LimitsQuery>;

const LatestReading = z
  .object({
    time: z.iso.datetime(),
    usedPercentage: z.number().min(0).max(100),
    resetsAt: z.iso.datetime(),
  })
  .strict();

export const LimitsResponse = z
  .object({
    windows: z.array(
      z
        .object({
          window: z.enum(["five_hour", "seven_day"]),
          resetsAt: z.iso.datetime(),
          peakUsedPercentage: z.number().min(0).max(100),
        })
        .strict(),
    ),
    latest: z
      .object({ five_hour: LatestReading.nullable(), seven_day: LatestReading.nullable() })
      .strict(),
  })
  .strict();
export type LimitsResponse = z.infer<typeof LimitsResponse>;

export * from "./paging.ts";

const WORK_PAGE = { defaultLimit: 100, maxLimit: 500 };
const RepoId = z.string().regex(/^[0-9a-f]{12}$/);

const workScopeShape = {
  client: ClientName.optional(),
  repo: RepoId.optional(),
  ...pageQueryShape(WORK_PAGE),
};

export const WorkIssuesQuery = z
  .object({
    ...workScopeShape,
    issue_state: z.string().min(1).max(100).optional(),
    state: z.enum(["open", "closed"]).optional(),
  })
  .strict();
export type WorkIssuesQuery = z.infer<typeof WorkIssuesQuery>;

export const WorkPullRequestsQuery = z.object(workScopeShape).strict();
export type WorkPullRequestsQuery = z.infer<typeof WorkPullRequestsQuery>;

export const WorkReleasesQuery = z.object(workScopeShape).strict();
export type WorkReleasesQuery = z.infer<typeof WorkReleasesQuery>;

export const WorkIssue = z
  .object({
    repoId: RepoId,
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    issueState: z.string(),
    priority: z.string(),
    labels: z.array(z.string()),
    author: z.string(),
    link: z.string().nullable(),
    relations: z
      .object({
        parent: z.number().int().nullable(),
        children: z.array(z.number().int()),
        blockedBy: z.array(z.number().int()),
      })
      .strict(),
    stale: z.boolean(),
  })
  .strict();
export type WorkIssue = z.infer<typeof WorkIssue>;

export const WorkIssuesResponse = pageResponseSchema(WorkIssue);
export type WorkIssuesResponse = z.infer<typeof WorkIssuesResponse>;

export const WorkPullRequest = z
  .object({
    repoId: RepoId,
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    headBranch: z.string(),
    baseBranch: z.string(),
    author: z.string(),
    checks: z.string(),
    labels: z.array(z.string()),
    link: z.string().nullable(),
    reviews: z.array(
      z.object({ author: z.string(), state: z.string(), count: z.number().int() }).strict(),
    ),
    stale: z.boolean(),
  })
  .strict();
export type WorkPullRequest = z.infer<typeof WorkPullRequest>;

export const WorkPullRequestsResponse = pageResponseSchema(WorkPullRequest);
export type WorkPullRequestsResponse = z.infer<typeof WorkPullRequestsResponse>;

export const WorkRelease = z
  .object({
    repoId: RepoId,
    name: z.string(),
    state: z.string(),
    link: z.string().nullable(),
    issueNumbers: z.array(z.number().int()),
    forgeRelease: z
      .object({
        tag: z.string(),
        targetCommit: z.string().nullable(),
        assetNames: z.array(z.string()),
        link: z.string().nullable(),
        noForgeRelease: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type WorkRelease = z.infer<typeof WorkRelease>;

export const WorkReleasesResponse = pageResponseSchema(WorkRelease);
export type WorkReleasesResponse = z.infer<typeof WorkReleasesResponse>;
export * from "./factory-health.ts";

export const SESSION_KINDS = ["unattended-loop", "attended-loop", "session"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SessionsQuery = z
  .object({
    day: UsageDate,
    tz: rangeShape.tz,
    client: ClientName.optional(),
    ...pageQueryShape({ defaultLimit: 50, maxLimit: 200 }),
  })
  .strict();
export type SessionsQuery = z.infer<typeof SessionsQuery>;

export const SessionSummary = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    kind: z.enum(SESSION_KINDS),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    continuesBefore: z.boolean(),
    continuesAfter: z.boolean(),
    projects: z
      .array(
        z.object({ id: z.string().regex(/^[0-9a-f]{12}$/), label: z.string().min(1) }).strict(),
      )
      .max(3),
    projectCount: z.number().int(),
    tokens: z.number().int(),
    turns: z.number().int(),
    userMessages: z.number().int(),
  })
  .strict();
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionsResponse = z
  .object({
    sessions: z.array(SessionSummary),
    total: z.number().int(),
    nextCursor: NextCursor,
  })
  .strict();
export type SessionsResponse = z.infer<typeof SessionsResponse>;
