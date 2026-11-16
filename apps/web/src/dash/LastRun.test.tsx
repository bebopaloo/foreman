import type { LastRun } from "@foreman/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";

const build = (
  issue: number,
  lane: number,
  start: string,
  end: string,
  result: string,
  extra: { title?: string | null; link?: string | null } = {},
) => ({
  title: null,
  link: null,
  ...extra,
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
    const bar = screen.getByRole("img", {
      name: "Issue 4 of acme/app: stopped at run end, 01:20 to 05:00",
    });
    expect(bar).toHaveTextContent("Issue 4 of acme/app: stopped at run end");
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
    expect(
      within(section).getByRole("img", { name: "Issue 1 of acme/app: running, 01:00 to 05:00" }),
    ).toBeInTheDocument();
  });

  describe("bars", () => {
    const linked = {
      ...run,
      builds: [
        build(12, 1, "01:00", "03:00", "merged", {
          title: "Add the export",
          link: "https://tracker.test/acme/app/12",
        }),
        build(7, 2, "01:10", "04:00", "blocked"),
      ] as LastRun["builds"],
      lanes: 2,
    };

    it("makes a bar with a link a link to the tracker issue in a new tab", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const bar = await screen.findByRole("link", {
        name: "Issue 12 of acme/app: merged, 01:00 to 03:00",
      });
      expect(bar).toHaveAttribute("href", "https://tracker.test/acme/app/12");
      expect(bar).toHaveAttribute("target", "_blank");
      expect(bar).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("makes a bar with no link a focusable image, not a link", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const bar = await screen.findByRole("img", {
        name: "Issue 7 of acme/app: blocked, 01:10 to 04:00",
      });
      expect(bar).toHaveAttribute("tabindex", "0");
      expect(screen.getAllByRole("link", { name: /^Issue / })).toHaveLength(1);
    });

    it("shows no link for an address that is not a web address", async () => {
      fakeApi({
        dash: {
          lastRun: {
            ...linked,
            builds: [
              build(12, 1, "01:00", "03:00", "merged", { link: "javascript:alert(1)" }),
            ] as LastRun["builds"],
            lanes: 1,
          },
        },
      });
      renderApp();
      expect(await screen.findByRole("img", { name: /^Issue 12 of/ })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Issue 12 of/ })).not.toBeInTheDocument();
    });

    it("shows a tooltip on keyboard focus, and Escape hides it", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const user = userEvent.setup();
      const bar = await screen.findByRole("link", { name: /^Issue 12 of/ });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      await user.click(document.body);
      bar.focus();
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent("acme/app#12Add the export01:0003:002 h 0 minmergedslot 1");
      expect(bar).toHaveAccessibleDescription(/Add the export/);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("shows the tooltip on mouse hover and keeps it while the mouse is on it", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const user = userEvent.setup();
      const bar = await screen.findByRole("link", { name: /^Issue 12 of/ });
      await user.hover(bar);
      const tooltip = await screen.findByRole("tooltip");
      // A browser sets `relatedTarget` when the mouse moves from the bar to the tooltip.
      fireEvent.mouseOut(bar, { relatedTarget: tooltip });
      fireEvent.mouseOver(tooltip, { relatedTarget: bar });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.mouseOut(tooltip, { relatedTarget: document.body });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("hides a hover tooltip with Escape", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const user = userEvent.setup();
      await user.hover(await screen.findByRole("link", { name: /^Issue 12 of/ }));
      expect(await screen.findByRole("tooltip")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("shows 'not in the Work cache' in place of a missing title", async () => {
      fakeApi({ dash: { lastRun: linked } });
      renderApp();
      const user = userEvent.setup();
      await user.hover(await screen.findByRole("img", { name: /^Issue 7 of/ }));
      expect(await screen.findByRole("tooltip")).toHaveTextContent("not in the Work cache");
    });

    it("shows a title with markup as plain text", async () => {
      const hostile = '<img src="https://evil.test/x.png"> **bold**';
      fakeApi({
        dash: {
          lastRun: {
            ...linked,
            builds: [
              build(12, 1, "01:00", "03:00", "merged", { title: hostile }),
            ] as LastRun["builds"],
            lanes: 1,
          },
        },
      });
      renderApp();
      const user = userEvent.setup();
      await user.hover(await screen.findByRole("img", { name: /^Issue 12 of/ }));
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent(hostile);
      expect(tooltip.querySelector("img")).toBeNull();
    });
  });
});
