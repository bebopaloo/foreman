import { HealthResponse } from "@foreman/shared";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const url = new URL("/api/health", window.location.origin);
  const response = await fetch(url, signal ? { signal } : {});
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Health check failed with status ${response.status.toString()}`);
  }
  return HealthResponse.parse(await response.json());
}
