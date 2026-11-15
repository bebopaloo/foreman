import type { RefreshStatusResponse } from "@foreman/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test-server.ts";
import { UsageStatus } from "./UsageStatus.tsx";

const idle: RefreshStatusResponse = {
  state: "idle",
  filesRead: null,
  filesTotal: null,
  dataAsOf: "2026-11-15T09:42:00.000Z",
  reason: null,
};

function serveStatus(next: () => RefreshStatusResponse) {
  const calls = { count: 0 };
  server.use(
    http.get("*/api/usage/status", () => {
      calls.count += 1;
      return HttpResponse.json(next());
    }),
  );
  return calls;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderStatus(onDataChanged?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsageStatus timeZone="UTC" {...(onDataChanged ? { onDataChanged } : {})} />
    </QueryClientProvider>,
  );
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("UsageStatus", () => {
  it("shows the time of the data", async () => {
    serveStatus(() => idle);
    renderStatus();
    expect(await screen.findByText(/Usage data as of/)).toHaveTextContent(
      "Usage data as of 15 Nov 2026, 09:42",
    );
  });

  it("shows the refresh progress, asks each 2 seconds and loads the panels at the end", async () => {
    let current: RefreshStatusResponse = {
      ...idle,
      state: "running",
      filesRead: 1240,
      filesTotal: 3100,
    };
    const calls = serveStatus(() => current);
    const onDataChanged = vi.fn();
    renderStatus(onDataChanged);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reading the history: 1,240 of 3,100 files",
    );
    const first = calls.count;
    await tick(2000);
    expect(calls.count).toBe(first + 1);

    current = { ...idle, dataAsOf: "2026-11-15T10:15:00.000Z" };
    await tick(2000);
    expect(await screen.findByText(/Usage data as of/)).toHaveTextContent("15 Nov 2026, 10:15");
    expect(screen.queryByText(/Reading the history/)).not.toBeInTheDocument();
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("loads the panels again when a refresh ends with the same time", async () => {
    let current: RefreshStatusResponse = { ...idle, state: "running", filesRead: 1, filesTotal: 2 };
    serveStatus(() => current);
    const onDataChanged = vi.fn();
    renderStatus(onDataChanged);
    await screen.findByText(/Reading the history/);
    current = idle;
    await tick(2000);
    await screen.findByText(/Usage data as of/);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("shows a failed refresh with its reason and the last good time", async () => {
    serveStatus(() => ({ ...idle, state: "failed", reason: "The database is not available." }));
    renderStatus();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The last usage refresh failed. The database is not available. The page shows the data as of 15 Nov 2026, 09:42.",
    );
  });

  it("shows a failed refresh with no good time", async () => {
    serveStatus(() => ({ ...idle, state: "failed", dataAsOf: null, reason: "No access." }));
    renderStatus();
    expect(await screen.findByRole("status")).toHaveTextContent(
      /^The last usage refresh failed\. No access\.$/,
    );
    expect(screen.getByText("No usage data yet")).toBeInTheDocument();
  });

  it("shows no usage data yet when no refresh has ended", async () => {
    serveStatus(() => ({ ...idle, dataAsOf: null }));
    renderStatus();
    expect(await screen.findByText("No usage data yet")).toBeInTheDocument();
    expect(screen.queryByText(/Usage data as of/)).not.toBeInTheDocument();
  });

  it("asks each 60 seconds, loads the panels only when the time changed, and stops in a hidden tab", async () => {
    let current = idle;
    const calls = serveStatus(() => current);
    const onDataChanged = vi.fn();
    renderStatus(onDataChanged);
    await screen.findByText(/Usage data as of/);
    expect(calls.count).toBe(1);

    await tick(60_000);
    expect(calls.count).toBe(2);
    expect(onDataChanged).not.toHaveBeenCalled();

    current = { ...idle, dataAsOf: "2026-11-15T11:00:00.000Z" };
    await tick(60_000);
    expect(calls.count).toBe(3);
    expect(onDataChanged).toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("hidden");
    });
    await tick(180_000);
    expect(calls.count).toBe(3);
  });

  it("shows one status line when the status cannot be read", async () => {
    server.use(http.get("*/api/usage/status", () => new HttpResponse(null, { status: 500 })));
    renderStatus();
    expect(await screen.findByRole("status")).toHaveTextContent("The usage status cannot be read.");
  });
});
