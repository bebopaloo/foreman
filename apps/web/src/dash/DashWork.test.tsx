import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, quietDash, renderApp } from "../test-render.tsx";

const inProgress = {
  state: "in_progress" as const,
  stale: false,
  heartbeatAt: "2026-11-15T11:56:00.000Z",
  heartbeatAgeSeconds: 240,
};

const tile = (label: string) =>
  within(screen.getByRole("list", { name: "Tiles" }))
    .getByText(label)
    .closest("li") as HTMLElement;

describe("Tiles", () => {
  it("shows the builds, the merged builds, the waits and the first-round pass", async () => {
    fakeApi({
      dash: {
        tiles: { builds: 6, peak: 4, merged: 2, waits: 5 },
        reviewHealth: {
          ...quietDash.reviewHealth,
          firstRound: { rate: 70, passed: 7, total: 10, tiers: [] },
        },
      },
    });
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    const builds = tile("Builds in the last run");
    expect(within(builds).getByText("6")).toBeInTheDocument();
    expect(within(builds).getByText("peak 4 at one time")).toBeInTheDocument();
    expect(within(tile("Merged in the last run")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Waits for you")).getByText("5")).toBeInTheDocument();
    const pass = tile("First-round pass");
    expect(within(pass).getByText("70%")).toBeInTheDocument();
    expect(within(pass).getByText("of 10 pull requests, last 30 days")).toBeInTheDocument();
  });

  it("shows the rate as the API rounds it", async () => {
    fakeApi({
      dash: {
        reviewHealth: {
          ...quietDash.reviewHealth,
          firstRound: { rate: 67, passed: 2, total: 3, tiers: [] },
        },
      },
    });
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    expect(within(tile("First-round pass")).getByText("67%")).toBeInTheDocument();
  });

  it("shows no gate decision and no run", async () => {
    fakeApi();
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    expect(
      within(tile("First-round pass")).getByText("no gate decision in 30 days"),
    ).toBeInTheDocument();
    expect(
      within(tile("Builds in the last run")).getByText("no run in the last 30 days"),
    ).toBeInTheDocument();
  });

  it("shows that the waits need a connection", async () => {
    fakeApi({
      dash: { tiles: { builds: null, peak: null, merged: null, waits: null }, pipeline: null },
    });
    renderApp();
    await screen.findByRole("list", { name: "Tiles" });
    expect(within(tile("Waits for you")).getByText("–")).toBeInTheDocument();
  });
});

const now = () => screen.getByRole("region", { name: "Now" });

describe("Now, the running builds", () => {
  it("shows the slots in use in the scope All", async () => {
    fakeApi({
      dash: { run: inProgress, running: { count: 4, slotLimit: 5 } },
    });
    renderApp();
    expect(await screen.findByText("4 of 5 build slots in use")).toBeInTheDocument();
  });

  it("shows the count with no slot count in a client scope", async () => {
    fakeApi({ dash: { run: inProgress, running: { count: 2, slotLimit: null } } });
    renderApp();
    expect(await screen.findByText("2 builds running")).toBeInTheDocument();
    expect(now()).not.toHaveTextContent("build slots");
  });

  it("shows the builds that wait for the next run, with no slot count", async () => {
    fakeApi({ dash: { running: { count: 2, slotLimit: null } } });
    renderApp();
    expect(await screen.findByText("2 builds wait for the next run")).toBeInTheDocument();
    expect(now()).not.toHaveTextContent("build slots");
  });

  it("uses the singular for one build", async () => {
    fakeApi({ dash: { running: { count: 1, slotLimit: null } } });
    renderApp();
    expect(await screen.findByText("1 build waits for the next run")).toBeInTheDocument();
  });
});

const strip = () => screen.getByRole("region", { name: "The pipeline now" });

describe("The pipeline now", () => {
  it("shows the count of each stage with a text label", async () => {
    fakeApi({
      dash: {
        pipeline: {
          spec: 2,
          issues: 1,
          ready: 3,
          inProgress: 2,
          inReview: 1,
          blocked: 1,
          done: 5,
          release: 2,
        },
      },
    });
    renderApp();
    await screen.findByRole("region", { name: "The pipeline now" });
    const items = within(strip()).getByRole("list", { name: "Pipeline stages" });
    const texts = within(items)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(texts).toEqual([
      "G1Spec2",
      "G2Issues1",
      "queueREADY3",
      "buildIN PROGRESS2",
      "reviewIN REVIEW1",
      "waitsBLOCKED1",
      "mergedDONE5",
      "G3Release2",
    ]);
    expect(strip()).not.toHaveTextContent("Data is not complete");
  });

  it("shows that the data is not complete when a repo is not connected", async () => {
    fakeApi({ dash: { complete: { connectedRepos: 2, missingRepos: 1 } } });
    renderApp();
    expect(
      await within(await screen.findByRole("region", { name: "The pipeline now" })).findByText(
        "Data is not complete: 1 repo not connected. See Repos.",
      ),
    ).toBeInTheDocument();
  });

  it("uses the plural for more repos", async () => {
    fakeApi({ dash: { complete: { connectedRepos: 1, missingRepos: 2 } } });
    renderApp();
    expect(
      await within(await screen.findByRole("region", { name: "The pipeline now" })).findByText(
        "Data is not complete: 2 repos not connected. See Repos.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the not connected text when no repo in scope is connected", async () => {
    fakeApi({
      dash: {
        pipeline: null,
        running: null,
        complete: { connectedRepos: 0, missingRepos: 3 },
      },
    });
    renderApp();
    const region = await screen.findByRole("region", { name: "The pipeline now" });
    expect(region).toHaveTextContent(
      "Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON in the .env file, then restart pnpm dev.",
    );
    expect(within(region).queryByRole("list", { name: "Pipeline stages" })).toBeNull();
  });
});
