import type { RunReportResponse } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { server } from "../test-server.ts";
import { runIdOf, runReportPath } from "./RunReportPage.tsx";

const HOSTILE = '<img src="https://evil.example/x.png"> **bold**';

const report: RunReportResponse = {
  runId: "run-7",
  start: "2026-11-14T22:00:00.000Z",
  end: "2026-11-14T22:05:00.000Z",
  stateChanges: [
    {
      time: "2026-11-14T22:01:00.000Z",
      repo: "/s/acme/app",
      issue: 8,
      from: "READY",
      to: "IN PROGRESS",
      reason: "build started",
    },
    {
      time: "2026-11-14T22:04:00.000Z",
      repo: "/s/acme/app",
      issue: 8,
      from: "IN REVIEW",
      to: "DONE",
      reason: "merged #50",
    },
  ],
  merges: [
    {
      time: "2026-11-14T22:04:00.000Z",
      repo: "/s/acme/app",
      issue: 8,
      pr: 50,
      tier: "sensitive",
      round: 2,
      counts: { minor: 2 },
    },
  ],
  blocked: [
    { time: "2026-11-14T22:03:00.000Z", repo: "/s/acme/app", issue: 14, reason: "CI fails on #58" },
  ],
  skips: {
    total: 3,
    byBlocker: [{ repo: "/s/acme/app", blocker: 8, issues: [9, 10] }],
    other: [{ repo: "/s/acme/app", issue: 11, reason: "waiting: build limit of 5 reached" }],
  },
  summary: { file: "2026-11-14-run-7.md", text: HOSTILE },
  slotUse: {
    slotLimit: 5,
    builds: 1,
    minutes: 4,
    average: 0.75,
    minutesAtCount: [1, 3, 0, 0, 0, 0],
    perMinute: [0, 1, 1, 1],
  },
  skippedLines: 0,
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("run report path", () => {
  it("reads the run ID of a path", () => {
    expect(runIdOf("/runs/run-7")).toBe("run-7");
    expect(runIdOf("/runs/")).toBeNull();
    expect(runIdOf("/runs/a/b")).toBeNull();
    expect(runIdOf("/work")).toBeNull();
    expect(runReportPath("run 7")).toBe("/runs/run%207");
  });
});

describe("Run report page", () => {
  it("shows each section and the slot-use chart", async () => {
    fakeApi();
    server.use(http.get("*/api/runs/run-7/report", () => HttpResponse.json(report)));
    window.history.replaceState(null, "", "/runs/run-7");
    renderApp();
    expect(await screen.findByRole("heading", { name: "Slot use", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Slot use",
      "Summary",
      "Merges",
      "BLOCKED items",
      "Skips",
      "State changes",
    ]);
    expect(screen.getByText(/Average busy slots/)).toHaveTextContent("0.75 of 5");
    const chart = screen.getByRole("table", { name: "Minutes at each busy slot count" });
    expect(within(chart).getByRole("row", { name: "1 3" })).toBeInTheDocument();
    const merges = screen.getByRole("table", { name: "Merges of the run" });
    expect(within(merges).getByText("sensitive")).toBeInTheDocument();
    expect(within(merges).getByText("round 2: 2 minor")).toBeInTheDocument();
    expect(screen.getByText("CI fails on #58")).toBeInTheDocument();
    const byBlocker = screen.getByRole("list", { name: "Skips by blocker" });
    expect(byBlocker).toHaveTextContent("app #8 blocked 2 issues: #9, #10");
    expect(screen.getByText("waiting: build limit of 5 reached")).toBeInTheDocument();
  });

  it("shows the summary as plain text, never as markup", async () => {
    fakeApi();
    server.use(http.get("*/api/runs/run-7/report", () => HttpResponse.json(report)));
    window.history.replaceState(null, "", "/runs/run-7");
    const { container } = renderApp();
    const summary = await screen.findByLabelText("Summary file 2026-11-14-run-7.md");
    expect(summary).toHaveTextContent(HOSTILE);
    expect(container.querySelector("img")).toBeNull();
  });

  it("says when the run is not found", async () => {
    fakeApi();
    server.use(
      http.get("*/api/runs/run-9/report", () => HttpResponse.json({ error: "x" }, { status: 404 })),
    );
    window.history.replaceState(null, "", "/runs/run-9");
    renderApp();
    expect(await screen.findByText(/No run with this ID/)).toBeInTheDocument();
  });
});
