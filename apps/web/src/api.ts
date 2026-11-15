import {
  HealthResponse,
  RefreshStatusResponse,
  WorkClientsResponse,
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

async function getJson<T>(path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), signal ? { signal } : {});
  if (response.status !== 200) {
    throw new Error(`${path} failed with status ${response.status.toString()}`);
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
