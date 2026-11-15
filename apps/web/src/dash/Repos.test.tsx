import type { DashResponse } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";
import { formatTime } from "../connection/connection.ts";

const repo = (
  over: Partial<DashResponse["repos"][number]> = {},
): DashResponse["repos"][number] => ({
  repoId: "r1",
  repo: "acme/app",
  client: "acme",
  state: "connected",
  dataAsOf: "2026-11-15T11:50:00.000Z",
  lastLogAt: "2026-11-15T09:30:00.000Z",
  lastControlAt: "2026-11-15T10:45:00.000Z",
  ...over,
});

const reposSection = () => screen.findByRole("region", { name: "Repos" });

describe("Repos", () => {
  it("shows each repo with its client, state, data as of, last log line and last Control event", async () => {
    fakeApi({
      dash: {
        repos: [
          repo(),
          repo({
            repoId: "r2",
            repo: "acme/site",
            state: "not connected: no token",
            dataAsOf: null,
            lastLogAt: null,
            lastControlAt: null,
          }),
          repo({ repoId: "r3", repo: "misc/notes", client: null, lastControlAt: null }),
        ],
      },
    });
    renderApp();
    const table = await within(await reposSection()).findByRole("table");
    const rows = within(table).getAllByRole("row");
    const cells = (index: number) =>
      within(rows[index] ?? table)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(
      within(rows[0] ?? table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Repo",
      "Client",
      "Connection",
      "Data as of",
      "Last night log line",
      "Last Control event",
    ]);
    expect(cells(1)).toEqual([
      "acme/app",
      "acme",
      "connected",
      formatTime("2026-11-15T11:50:00.000Z"),
      formatTime("2026-11-15T09:30:00.000Z"),
      formatTime("2026-11-15T10:45:00.000Z"),
    ]);
    expect(cells(2)).toEqual([
      "acme/site",
      "acme",
      "not connected: no token",
      "none",
      "none",
      "none",
    ]);
    expect(cells(3)).toEqual([
      "misc/notes",
      "no client",
      "connected",
      formatTime("2026-11-15T11:50:00.000Z"),
      formatTime("2026-11-15T09:30:00.000Z"),
      "none",
    ]);
  });

  it("says that no repo is in scope", async () => {
    fakeApi({ dash: { repos: [] } });
    renderApp();
    expect(await within(await reposSection()).findByText("No repo in scope.")).toBeInTheDocument();
  });
});
