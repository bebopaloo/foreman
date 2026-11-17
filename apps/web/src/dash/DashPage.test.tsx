import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashRequests, fakeApi, renderApp } from "../test-render.tsx";

const status = {
  state: "stalled" as const,
  runId: "run-42",
  lockStale: false,
  stalledBy: "quiet" as const,
  heartbeatAt: "2026-11-15T11:20:00.000Z",
  lastLineAt: "2026-11-15T11:21:00.000Z",
  loopActivityAt: "2026-11-15T11:22:00.000Z",
  loopEndedTurnAt: null,
  agentsInFlight: 0,
  quietSeconds: 1680,
  stallAfterSeconds: 1200,
  hasSummary: null,
};

const inProgress = {
  run: {
    state: "in_progress" as const,
    stale: false,
    heartbeatAt: "2026-11-15T11:56:00.000Z",
    heartbeatAgeSeconds: 240,
  },
};

describe("Now run states", () => {
  beforeEach(() => {
    document.title = "foreman";
  });

  it("shows a stalled run with its evidence and puts a prefix on the tab title", async () => {
    fakeApi({ dash: { ...inProgress, runStatus: status } });
    renderApp();
    expect(await screen.findByText("Run stalled")).toBeInTheDocument();
    expect(screen.getByText(/no activity for 28 minutes/)).toBeInTheDocument();
    expect(screen.getByText("Heartbeat at 11:20Z.")).toBeInTheDocument();
    expect(screen.getByText("Last night log line at 11:21Z.")).toBeInTheDocument();
    expect(screen.getByText("Loop session transcript last written at 11:22Z.")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe("Stalled · foreman");
    });
  });

  it("shows a loop session that ended its turn", async () => {
    fakeApi({
      dash: {
        ...inProgress,
        runStatus: {
          ...status,
          stalledBy: "end-turn",
          loopEndedTurnAt: "2026-11-15T11:55:00.000Z",
        },
      },
    });
    renderApp();
    expect(
      await screen.findByText(
        "The loop session ended its turn at 11:55Z, and no background agent runs.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the tab title plain for a run that is not stalled", async () => {
    fakeApi({
      dash: { ...inProgress, runStatus: { ...status, state: "running", stalledBy: null } },
    });
    renderApp();
    expect(await screen.findByText("Run in progress")).toBeInTheDocument();
    expect(document.title).not.toContain("Stalled");
  });

  it("shows an ended run with no summary file", async () => {
    fakeApi({
      dash: {
        runStatus: {
          ...status,
          state: "ended-without-summary",
          stalledBy: null,
          quietSeconds: null,
          hasSummary: false,
        },
      },
    });
    renderApp();
    expect(await screen.findByText("No run in progress")).toBeInTheDocument();
    expect(screen.getByText("Run run-42 ended and has no summary file.")).toBeInTheDocument();
  });

  it("shows the night log lines that name no repo", async () => {
    fakeApi({ dash: { unmapped: { lines: 3, repos: ["foreman"] } } });
    renderApp();
    expect(
      await screen.findByText(
        /3 night log lines name a repo that is not in the repo list: foreman/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Now", () => {
  it("shows a run in progress with the heartbeat age", async () => {
    fakeApi({ dash: inProgress });
    renderApp();
    expect(await screen.findByText("Run in progress")).toBeInTheDocument();
    expect(screen.getByText(/heartbeat 4 minutes ago/)).toBeInTheDocument();
  });

  it("shows 0 minutes for a heartbeat in the future", async () => {
    fakeApi({ dash: { run: { ...inProgress.run, heartbeatAgeSeconds: 0 } } });
    renderApp();
    expect(await screen.findByText(/heartbeat 0 minutes ago/)).toBeInTheDocument();
  });

  it("shows no run and a stale lock", async () => {
    fakeApi({ dash: { run: { ...inProgress.run, state: "none", stale: true } } });
    renderApp();
    expect(await screen.findByText("No run in progress")).toBeInTheDocument();
    expect(screen.getByText(/a stopped run left a stale lock/)).toBeInTheDocument();
  });

  it("shows no run when there is no lock and no night log", async () => {
    fakeApi({ dash: { sources: { runs: "missing", controls: "missing" } } });
    renderApp();
    expect(await screen.findByText("No run in progress")).toBeInTheDocument();
    expect(screen.queryByText(/stale lock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot read/)).not.toBeInTheDocument();
  });

  it("shows an unreadable lock", async () => {
    fakeApi({
      dash: {
        run: { state: "unreadable", stale: false, heartbeatAt: null, heartbeatAgeSeconds: null },
      },
    });
    renderApp();
    expect(await screen.findByText("run lock unreadable")).toBeInTheDocument();
  });

  it("shows a factory folder that the API cannot read in Now and in Review health", async () => {
    fakeApi({ dash: { sources: { runs: "unreadable", controls: "unreadable" } } });
    renderApp();
    await waitFor(() => {
      expect(screen.getAllByText("cannot read the factory folder")).toHaveLength(2);
    });
  });

  it("tells the Operator when the dash data cannot be read", async () => {
    fakeApi();
    const { server } = await import("../test-server.ts");
    const { http, HttpResponse } = await import("msw");
    server.use(http.get("*/api/dash", () => new HttpResponse(null, { status: 500 })));
    renderApp();
    expect(await screen.findByText(/The dash data cannot be read/)).toBeInTheDocument();
  });
});

describe("the dash request", () => {
  it("sends the Client scope", async () => {
    window.history.replaceState(null, "", "/?client=acme");
    fakeApi();
    renderApp();
    await screen.findByText("No run in progress");
    expect(dashRequests).toContain("/api/dash?client=acme");
  });
});

describe("live update", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    setVisibility("visible");
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  const dashCalls = () => dashRequests.length;

  it("asks again after 60 seconds in a visible tab", async () => {
    fakeApi();
    renderApp();
    await screen.findByText("No run in progress");
    expect(dashCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect(dashCalls()).toBe(2);
    });
  });

  it("does not ask while the tab is hidden", async () => {
    fakeApi();
    renderApp();
    await screen.findByText("No run in progress");
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(dashCalls()).toBe(1);
  });
});
