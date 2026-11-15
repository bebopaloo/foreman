import {
  BreakdownResponse,
  ControlsRegisterResponse,
  ControlsReleasesResponse,
  ControlsResponse,
  ControlsWaiversResponse,
  DashResponse,
  HealthResponse,
  LedgerResponse,
  LimitsResponse,
  ProjectsResponse,
  RefreshStatusResponse,
  ReviewsPullRequestsResponse,
  ReviewsResponse,
  SessionResponse,
  SessionsResponse,
  SeriesResponse,
  WorkClientsResponse,
  WorkItemsResponse,
  WorkReposResponse,
  WorkStatusResponse,
} from "@foreman/shared";

function apiUrl(path: string): URL {
  return new URL(path, window.location.origin);
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(apiUrl("/api/health"), signal ? { signal } : {});
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Health check failed with status ${response.status.toString()}`);
  }
  return HealthResponse.parse(await response.json());
}

interface Schema<T> {
  parse(data: unknown): T;
}

/** A request that the API answered with a status other than the expected one. */
export class ApiStatusError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path} failed with status ${status.toString()}`);
    this.name = "ApiStatusError";
    this.status = status;
  }
}

async function getJson<T>(path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), signal ? { signal } : {});
  if (response.status !== 200) {
    throw new ApiStatusError(path, response.status);
  }
  return schema.parse(await response.json());
}

async function postJson<T>(path: string, schema: Schema<T>): Promise<T> {
  const response = await fetch(apiUrl(path), { method: "POST" });
  if (response.status !== 202) {
    throw new Error(`${path} failed with status ${response.status.toString()}`);
  }
  return schema.parse(await response.json());
}

export const fetchWorkClients = (signal?: AbortSignal): Promise<WorkClientsResponse> =>
  getJson("/api/work/clients", WorkClientsResponse, signal);

export const fetchWorkRepos = (signal?: AbortSignal): Promise<WorkReposResponse> =>
  getJson("/api/work/repos", WorkReposResponse, signal);

export const fetchWorkStatus = (signal?: AbortSignal): Promise<WorkStatusResponse> =>
  getJson("/api/work/status", WorkStatusResponse, signal);

export const fetchUsageStatus = (signal?: AbortSignal): Promise<RefreshStatusResponse> =>
  getJson("/api/usage/status", RefreshStatusResponse, signal);

export const refreshWork = (): Promise<WorkStatusResponse> =>
  postJson("/api/work/refresh", WorkStatusResponse);

export const refreshUsage = (): Promise<RefreshStatusResponse> =>
  postJson("/api/usage/refresh", RefreshStatusResponse);

export const fetchDash = (client: string | null, signal?: AbortSignal): Promise<DashResponse> =>
  getJson(
    client === null ? "/api/dash" : `/api/dash?${new URLSearchParams({ client }).toString()}`,
    DashResponse,
    signal,
  );

/** One page of the joined work rows. `query` holds the filter values and the sort, as URL values. */
export const fetchWorkItems = (
  query: Record<string, string>,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<WorkItemsResponse> => {
  const params = new URLSearchParams(query);
  if (cursor !== null) params.set("cursor", cursor);
  const text = params.toString();
  return getJson(`/api/work/items${text === "" ? "" : `?${text}`}`, WorkItemsResponse, signal);
};

export interface UsageQuery {
  from: string;
  to: string;
  tz: string;
  /** The Client scope. Null is "All". */
  client: string | null;
  /** A Project ID. It limits the usage to this Project. */
  project?: string;
}

function usageParams(query: UsageQuery, extra: Record<string, string>): string {
  const params = new URLSearchParams({ from: query.from, to: query.to, tz: query.tz, ...extra });
  if (query.client !== null) params.set("client", query.client);
  if (query.project !== undefined) params.set("project", query.project);
  return params.toString();
}

export const fetchUsageBreakdown = (
  query: UsageQuery,
  dimension: string,
  limit: number,
  signal?: AbortSignal,
): Promise<BreakdownResponse> =>
  getJson(
    `/api/usage/breakdown?${usageParams(query, { dimension, limit: String(limit) })}`,
    BreakdownResponse,
    signal,
  );

export const fetchUsageSeries = (
  query: UsageQuery,
  grain: string,
  signal?: AbortSignal,
): Promise<SeriesResponse> =>
  getJson(`/api/usage/series?${usageParams(query, { grain })}`, SeriesResponse, signal);

/** The Limit windows are plan-wide, so this query has no client. */
export const fetchUsageLimits = (
  query: { from: string; to: string; tz: string },
  signal?: AbortSignal,
): Promise<LimitsResponse> =>
  getJson(`/api/usage/limits?${new URLSearchParams(query).toString()}`, LimitsResponse, signal);

export const fetchUsageProjects = (
  client: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<ProjectsResponse> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (client !== null) params.set("client", client);
  return getJson(`/api/usage/projects?${params.toString()}`, ProjectsResponse, signal);
};

export interface SessionsQuery {
  /** A calendar day, `YYYY-MM-DD`, in the time zone `tz`. */
  day: string;
  tz: string;
  /** The Client scope. Null is "All". */
  client: string | null;
}

function sessionsParams(query: SessionsQuery, cursor: string | null): string {
  const params = new URLSearchParams({ day: query.day, tz: query.tz });
  if (query.client !== null) params.set("client", query.client);
  if (cursor !== null) params.set("cursor", cursor);
  return params.toString();
}

export const fetchSessions = (
  query: SessionsQuery,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<SessionsResponse> =>
  getJson(`/api/sessions?${sessionsParams(query, cursor)}`, SessionsResponse, signal);

export const fetchSession = (
  sessionId: string,
  query: SessionsQuery,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<SessionResponse> =>
  getJson(
    `/api/sessions/${encodeURIComponent(sessionId)}?${sessionsParams(query, cursor)}`,
    SessionResponse,
    signal,
  );

/** One Reviews document. `mode` chooses the findings events. */
export const fetchReviews = (
  client: string | null,
  mode: string,
  signal?: AbortSignal,
): Promise<ReviewsResponse> => {
  const params = new URLSearchParams({ mode });
  if (client !== null) params.set("client", client);
  return getJson(`/api/reviews?${params.toString()}`, ReviewsResponse, signal);
};

/** One page of the pull request rows of the Reviews view. */
export const fetchReviewsPullRequests = (
  client: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ReviewsPullRequestsResponse> => {
  const params = new URLSearchParams();
  if (client !== null) params.set("client", client);
  if (cursor !== null) params.set("cursor", cursor);
  const text = params.toString();
  return getJson(
    `/api/reviews/pull-requests${text === "" ? "" : `?${text}`}`,
    ReviewsPullRequestsResponse,
    signal,
  );
};

const scopedPath = (path: string, client: string | null, cursor: string | null = null): string => {
  const params = new URLSearchParams();
  if (client !== null) params.set("client", client);
  if (cursor !== null) params.set("cursor", cursor);
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
};

/** The Controls document. */
export const fetchControls = (
  client: string | null,
  signal?: AbortSignal,
): Promise<ControlsResponse> =>
  getJson(scopedPath("/api/controls", client), ControlsResponse, signal);

/** One page of the Waiver rows of the Controls view. */
export const fetchControlsWaivers = (
  client: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ControlsWaiversResponse> =>
  getJson(scopedPath("/api/controls/waivers", client, cursor), ControlsWaiversResponse, signal);

/** One page of the Release rows of the Controls view. */
export const fetchControlsReleases = (
  client: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ControlsReleasesResponse> =>
  getJson(scopedPath("/api/controls/releases", client, cursor), ControlsReleasesResponse, signal);

/** One page of the Control register list of the Controls view. */
export const fetchControlsRegister = (
  client: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ControlsRegisterResponse> =>
  getJson(scopedPath("/api/controls/register", client, cursor), ControlsRegisterResponse, signal);

export interface LedgerRange {
  /** The first day of the range, `YYYY-MM-DD`, in the ledger time zone. */
  from: string;
  to: string;
}

/** One page of the ledger. With no range, the API chooses this month. */
export const fetchLedger = (
  range: LedgerRange | null,
  client: string | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<LedgerResponse> => {
  const params = new URLSearchParams();
  if (range !== null) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  if (client !== null) params.set("client", client);
  if (cursor !== null) params.set("cursor", cursor);
  const text = params.toString();
  return getJson(`/api/ledger${text === "" ? "" : `?${text}`}`, LedgerResponse, signal);
};
