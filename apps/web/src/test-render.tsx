import type { DashResponse, WorkBlockersResponse } from "@foreman/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { App } from "./App.tsx";
import { ScopeProvider } from "./scope/index.ts";
import { server } from "./test-server.ts";

export interface FakeRepo {
  id: string;
  fullName: string;
  client: string | null;
  dataAsOf: string | null;
}

export interface FakeApi {
  clients?: { name: string; repoCount: number }[];
  unassignedCount?: number;
  repos?: FakeRepo[];
  owners?: { host: string; owner: string; state: string }[];
  state?: "idle" | "running" | "failed";
  reason?: string | null;
  /** Parts of the dash response. */
  dash?: Partial<DashResponse>;
  /** The blockers response. The default has no blocker. */
  blockers?: WorkBlockersResponse;
}

/** Each request for the dash since the last `fakeApi` call, as path and query. */
export const dashRequests: string[] = [];

export const quietDash: DashResponse = {
  run: { state: "none", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null },
  lastRun: null,
  reviewHealth: {
    firstRound: { rate: null, passed: 0, total: 0, tiers: [] },
    rounds: { one: 0, two: 0, three: 0 },
    escalations: 0,
    waiversInUse: 0,
    factoryLoginSet: true,
    reposWithoutControls: [],
  },
  tiles: { builds: null, peak: null, merged: null, waits: 0 },
  running: { count: 0, slotLimit: null },
  pipeline: {
    spec: 0,
    issues: 0,
    ready: 0,
    inProgress: 0,
    inReview: 0,
    blocked: 0,
    done: 0,
    release: 0,
  },
  waits: { total: 0, items: [] },
  complete: { connectedRepos: 1, missingRepos: 0 },
  repos: [],
  sources: { runs: "ok", controls: "ok" },
  skipped: { nightLogLines: 0, controlEvents: 0, files: 0, lock: 0 },
};

const statusBody = (api: FakeApi) => ({
  state: api.state ?? "idle",
  reason: api.reason ?? null,
  lastFetchStartedAt: null,
  lastFetchAt: null,
  lastFullFetchStartedAt: null,
  lastFullFetchAt: null,
  problems: [],
  owners: api.owners ?? [{ host: "github.com", owner: "acme", state: "connected" }],
  repos: [],
});

/** Fakes the dash, work and health routes over HTTP. The returned list holds each request as `METHOD path`. */
export function fakeApi(api: FakeApi = {}): string[] {
  const calls: string[] = [];
  dashRequests.length = 0;
  server.use(
    http.get("*/api/health", () => HttpResponse.json({ status: "ok", version: "1.2.3" })),
    http.get("*/api/dash", ({ request }) => {
      const url = new URL(request.url);
      dashRequests.push(`${url.pathname}${url.search}`);
      return HttpResponse.json({ ...quietDash, ...api.dash });
    }),
    http.get("*/api/work/blockers", () =>
      HttpResponse.json(api.blockers ?? { total: 0, items: [] }),
    ),
    http.get("*/api/work/clients", () =>
      HttpResponse.json({
        clients: api.clients ?? [
          { name: "acme", repoCount: 2 },
          { name: "bebopaloo", repoCount: 1 },
        ],
        unassignedCount: api.unassignedCount ?? 0,
      }),
    ),
    http.get("*/api/work/repos", () =>
      HttpResponse.json({
        repos: (api.repos ?? []).map((repo) => ({
          ...repo,
          host: "github.com",
          state: "connected",
        })),
      }),
    ),
    http.get("*/api/work/status", () => HttpResponse.json(statusBody(api))),
    http.post("*/api/work/refresh", () => {
      calls.push("POST /api/work/refresh");
      return HttpResponse.json(statusBody({ ...api, state: "running" }), { status: 202 });
    }),
    http.post("*/api/usage/refresh", () => {
      calls.push("POST /api/usage/refresh");
      return HttpResponse.json(
        { state: "running", filesRead: 0, filesTotal: 1, dataAsOf: null, reason: null },
        { status: 202 },
      );
    }),
  );
  return calls;
}

export function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScopeProvider>
        <App />
      </ScopeProvider>
    </QueryClientProvider>,
  );
}
