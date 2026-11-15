import type { LastRun } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";

const build = (issue: number, lane: number, start: string, end: string, result: string) => ({
  repoId: "r1",
  repo: "acme/app",
  issue,
  lane,
  start: `2026-11-14T${start}:00.000Z`,
  end: `2026-11-14T${end}:00.000Z`,
  result,
});

const run: LastRun = {
  runId: "run-7",
  start: "2026-11-14T01:00:00.000Z",
  end: "2026-11-14T05:00:00.000Z",
  running: false,
  lanes: 3,
  skips: 9,
  blockedAtSelection: 1,
  builds: [
    build(1, 1, "01:00", "03:00", "merged"),
    build(2, 2, "01:10", "04:00", "merge-ready"),
    build(3, 1, "03:30", "05:00", "blocked"),
    build(4, 3, "01:20", "05:00", "stopped at run end"),
  ] as LastRun["builds"],
};

const lastRun = () => screen.getByRole("region", { name: "Last run" });

describe("Last run", () => {
  it("shows that no run ran in the last 30 days", async () => {
    fakeApi({ dash: { lastRun: null } });
    renderApp();
    expect(await screen.findByText("No run in the last 30 days")).toBeInTheDocument();
  });

  it("shows no data for a factory folder that the API cannot read", async () => {
    fakeApi({ dash: { lastRun: null, sources: { runs: "unreadable", controls: "ok" } } });
    renderApp();
    expect(await screen.findByText("No data. See Now.")).toBeInTheDocument();
    expect(screen.queryByText("No run in the last 30 days")).not.toBeInTheDocument();
  });

  it("shows the lanes, with a text label and a colour for each result", async () => {
    fakeApi({ dash: { lastRun: run } });
    renderApp();
    expect(await screen.findByText("4 builds")).toBeInTheDocument();
    expect(screen.getAllByText("slot 1")).toHaveLength(1);
    expect(screen.getByText("slot 3")).toBeInTheDocument();
    const bar = screen.getByTitle("acme/app #4: stopped at run end");
    expect(bar).toHaveTextContent("acme/app #4 · stopped at run end");
    expect(bar).toHaveStyle({ background: "#565d6a" });
    const legend = within(within(lastRun()).getByRole("list", { name: "Results" }));
    expect(legend.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "merged",
      "merge-ready",
      "blocked",
      "stopped at run end",
    ]);
  });

  it("has a table of the same builds for a screen reader", async () => {
    fakeApi({ dash: { lastRun: run } });
    renderApp();
    const table = await screen.findByRole("table", { name: "Builds of the last run" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent)
          .filter((_, index) => [0, 1, 2, 5].includes(index)),
      ),
    ).toEqual([
      ["1", "acme/app", "1", "merged"],
      ["2", "acme/app", "2", "merge-ready"],
      ["1", "acme/app", "3", "blocked"],
      ["3", "acme/app", "4", "stopped at run end"],
    ]);
  });

  it("shows the skips and the issues blocked at selection, with no bar for them", async () => {
    fakeApi({ dash: { lastRun: { ...run, builds: [], lanes: 0 } } });
    renderApp();
    expect(await screen.findByText("9 skips")).toBeInTheDocument();
    expect(screen.getByText("1 blocked at selection")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks a run in progress", async () => {
    fakeApi({
      dash: {
        lastRun: {
          ...run,
          running: true,
          builds: [build(1, 1, "01:00", "05:00", "running")] as LastRun["builds"],
          lanes: 1,
        },
      },
    });
    renderApp();
    const section = await screen.findByRole("region", { name: "Last run" });
    expect(await within(section).findByText("Run in progress")).toBeInTheDocument();
    expect(within(section).getByTitle("acme/app #1: running")).toBeInTheDocument();
  });
});
