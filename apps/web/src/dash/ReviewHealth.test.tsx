import { screen, within } from "@testing-library/react";
import type { DashResponse } from "@foreman/shared";
import { describe, expect, it } from "vitest";
import { fakeApi, quietDash, renderApp } from "../test-render.tsx";

const health = (over: Partial<DashResponse["reviewHealth"]>): DashResponse["reviewHealth"] => ({
  ...quietDash.reviewHealth,
  ...over,
});

async function section() {
  return within(await screen.findByRole("region", { name: "Review health" }));
}

describe("Review health", () => {
  it("shows the pass rate by tier, the rounds, the escalations and the Waivers", async () => {
    fakeApi({
      dash: {
        reviewHealth: health({
          firstRound: {
            rate: 70,
            passed: 7,
            total: 10,
            tiers: [
              { tier: "general", passed: 4, total: 5, rate: 80 },
              { tier: null, passed: 1, total: 2, rate: 50 },
            ],
          },
          rounds: { one: 8, two: 1, three: 1 },
          escalations: 3,
          waiversInUse: 2,
        }),
      },
    });
    renderApp();
    const view = await section();
    expect(await view.findByText("70% of 10 pull requests")).toBeInTheDocument();
    const tiers = view.getByRole("list", { name: "First-round pass by Risk tier" });
    expect(within(tiers).getByText("general")).toBeInTheDocument();
    expect(within(tiers).getByText("80% of 5")).toBeInTheDocument();
    expect(within(tiers).getByText("no tier")).toBeInTheDocument();
    const rounds = view.getByRole("list", { name: "Pull requests by highest round" });
    expect(
      within(rounds)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Round 18", "Round 21", "Round 31"]);
    expect(view.getByText("Escalations: 3")).toBeInTheDocument();
    expect(view.getByText("Waivers in use: 2")).toBeInTheDocument();
  });

  it("says that there is no gate decision in 30 days", async () => {
    fakeApi();
    renderApp();
    expect(await (await section()).findByText("no gate decision in 30 days")).toBeInTheDocument();
  });

  it("shows the factory pull request counts of a repo with no Control events", async () => {
    fakeApi({
      dash: {
        reviewHealth: health({
          reposWithoutControls: [{ repoId: "r1", repo: "acme/app", reviewed: 3, unreviewed: 1 }],
        }),
      },
    });
    renderApp();
    const list = await (
      await section()
    ).findByRole("list", { name: "Repos with no Control events" });
    expect(await within(list).findByText(/no Control events in 30 days/)).toBeInTheDocument();
    expect(list).toHaveTextContent("3 factory pull requests reviewed by the Factory identity");
    expect(list).toHaveTextContent("1 factory pull request with no Factory identity review");
  });

  it("shows that the Factory identity login is not set, with no counts", async () => {
    fakeApi({
      dash: {
        reviewHealth: health({
          factoryLoginSet: false,
          reposWithoutControls: [
            { repoId: "r1", repo: "acme/app", reviewed: null, unreviewed: null },
          ],
        }),
      },
    });
    renderApp();
    const list = await (
      await section()
    ).findByRole("list", { name: "Repos with no Control events" });
    expect(await within(list).findByText(/Factory identity login not set/)).toBeInTheDocument();
    expect(list).not.toHaveTextContent("reviewed by");
  });

  it("shows the not connected text for the Factory identity counts when no repo is connected", async () => {
    fakeApi({ dash: { complete: { connectedRepos: 0, missingRepos: 3 } } });
    renderApp();
    const view = await section();
    expect(
      await view.findByText(/Not connected. Add the Foreman token to the Keychain/),
    ).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Control health" })).toBeInTheDocument();
  });

  it("shows that the Factory identity counts are not complete when a repo is not connected", async () => {
    fakeApi({ dash: { complete: { connectedRepos: 2, missingRepos: 1 } } });
    renderApp();
    const view = await section();
    expect(
      await view.findByText("Data is not complete: 1 repo not connected. See Repos."),
    ).toBeInTheDocument();
  });

  it("shows no note when every repo is connected", async () => {
    fakeApi({ dash: { complete: { connectedRepos: 2, missingRepos: 0 } } });
    renderApp();
    const view = await section();
    await view.findByText("Control health");
    expect(view.queryByText(/not complete|Not connected/)).toBeNull();
  });
});
