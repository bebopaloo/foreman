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
}

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

/** Fakes the work and health routes over HTTP. The returned list holds each request as `METHOD path`. */
export function fakeApi(api: FakeApi = {}): string[] {
  const calls: string[] = [];
  server.use(
    http.get("*/api/health", () => HttpResponse.json({ status: "ok", version: "1.2.3" })),
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
