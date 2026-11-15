import type { WorkReposResponse, WorkStatusResponse } from "@foreman/shared";
import type { Scope } from "../scope/index.ts";

const CONNECTED = "connected";

export interface ConnectionSummary {
  tone: "ok" | "warn" | "off";
  title: string;
  detail: string;
}

/** One line for the header: connected, partly connected or not connected, with the owner problems. */
export function summariseConnection(status: WorkStatusResponse): ConnectionSummary {
  const { owners } = status;
  if (owners.length === 0) {
    return { tone: "off", title: "Not connected", detail: status.reason ?? "No repo to connect" };
  }
  const problems = owners.filter((owner) => owner.state !== CONNECTED);
  const detail = problems.map((owner) => `${owner.host}/${owner.owner}: ${owner.state}`).join("; ");
  if (problems.length === 0) return { tone: "ok", title: "Connected", detail: "" };
  if (problems.length === owners.length) return { tone: "off", title: "Not connected", detail };
  return { tone: "warn", title: "Partly connected", detail };
}

/** The oldest "data as of" time of the repos in scope, or null when none has data. */
export function oldestDataAsOf(repos: WorkReposResponse["repos"], scope: Scope): string | null {
  const times = repos
    .filter((repo) => scope === null || repo.client === scope)
    .flatMap((repo) => (repo.dataAsOf === null ? [] : [repo.dataAsOf]));
  const [oldest] = times.sort();
  return oldest ?? null;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}
