import type { WorkBlocker } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp } from "../test-render.tsx";

const blocker = (over: Partial<WorkBlocker> = {}): WorkBlocker => ({
  repoId: "a1b2c3d4e5f6",
  repo: "acme/app",
  number: 26,
  title: "Add the retry queue",
  issueState: "READY",
  labels: [],
  link: "https://github.com/acme/app/issues/26",
  direct: [27, 28],
  cutsOff: [27, 28, 29],
  ...over,
});

const section = () => screen.findByRole("region", { name: "Unblock first" });

describe("Unblock first", () => {
  it("shows each blocker with its state, its count and its link", async () => {
    fakeApi({
      blockers: {
        total: 2,
        items: [
          blocker({ issueState: "BLOCKED", labels: ["attended-only"] }),
          blocker({ number: 9, title: "Second", link: null, direct: [], cutsOff: [10] }),
        ],
      },
    });
    renderApp();
    const region = await section();
    const [first, second] = await within(region).findAllByRole("listitem");
    if (first === undefined || second === undefined) throw new Error("two rows expected");
    expect(first).toHaveTextContent("acme/app #26");
    expect(first).toHaveTextContent("Add the retry queue");
    expect(first).toHaveTextContent("BLOCKED");
    expect(first).toHaveTextContent("attended-only");
    expect(first).toHaveTextContent("cuts off 3");
    expect(within(first).getByRole("link")).toHaveAttribute(
      "href",
      "https://github.com/acme/app/issues/26",
    );
    expect(second).toHaveTextContent("cuts off 1");
    expect(within(second).queryByRole("link")).toBeNull();
  });

  it("says that no issue blocks another", async () => {
    fakeApi();
    renderApp();
    const region = await section();
    expect(
      await within(region).findByText("No open issue blocks another open issue in this scope."),
    ).toBeInTheDocument();
  });

  it("shows the first 5 and a button that shows all", async () => {
    const items = Array.from({ length: 5 }, (_, index) => blocker({ number: index + 1 }));
    fakeApi({ blockers: { total: 8, items } });
    renderApp();
    const region = await section();
    expect(await within(region).findAllByRole("listitem")).toHaveLength(5);
    expect(within(region).getByRole("button", { name: "Show all 8" })).toBeInTheDocument();
    await userEvent.click(within(region).getByRole("button", { name: "Show all 8" }));
    expect(
      await within(region).findByRole("button", { name: "Show the first 5" }),
    ).toBeInTheDocument();
  });
});
