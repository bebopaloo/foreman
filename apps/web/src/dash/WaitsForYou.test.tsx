import type { DashResponse, WaitItem } from "@foreman/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, quietDash, renderApp } from "../test-render.tsx";

const item = (over: Partial<WaitItem> = {}): WaitItem => ({
  kind: "blocked",
  repoId: "a1",
  repo: "acme/app",
  number: 12,
  title: "Reject a transfer",
  reason: "auto mode refused the migration",
  source: "night log",
  link: "https://github.com/acme/app/issues/12",
  ...over,
});

const waits = () => screen.findByRole("region", { name: "Waits for you" });

async function show(dash: Partial<DashResponse>) {
  fakeApi({ dash });
  renderApp();
  await screen.findByRole("list", { name: "Tiles" });
  return waits();
}

describe("Waits for you", () => {
  it("shows each item with its repo, number, title, reason, source and link", async () => {
    const section = await show({
      waits: {
        total: 2,
        items: [
          item(),
          item({
            kind: "release",
            number: 79,
            title: "Release 1.2",
            reason: "Release to perform",
            source: "forge",
            link: "https://github.com/acme/app/pull/79",
          }),
        ],
      },
    });
    const [first, second] = within(section).getAllByRole("listitem");
    if (first === undefined || second === undefined) throw new Error("two items expected");
    expect(first).toHaveTextContent("acme/app #12");
    expect(first).toHaveTextContent("Reject a transfer");
    expect(first).toHaveTextContent("auto mode refused the migration");
    expect(first).toHaveTextContent("source: night log");
    expect(within(first).getByRole("link")).toHaveAttribute(
      "href",
      "https://github.com/acme/app/issues/12",
    );
    expect(second).toHaveTextContent("acme/app PR #79");
    expect(second).toHaveTextContent("Release to perform");
    expect(second).toHaveTextContent("source: forge");
  });

  it("shows the note to run factory-next", async () => {
    const section = await show({ waits: { total: 1, items: [item()] } });
    expect(within(section).getByText("run factory-next to act")).toBeInTheDocument();
  });

  it("shows 'and N more' after the listed items", async () => {
    const items = Array.from({ length: 20 }, (_, index) => item({ number: index + 1 }));
    const section = await show({ waits: { total: 30, items } });
    expect(within(section).getAllByRole("listitem")).toHaveLength(20);
    expect(within(section).getByText("and 10 more")).toBeInTheDocument();
  });

  it("shows no 'and N more' when all items show", async () => {
    const section = await show({ waits: { total: 1, items: [item()] } });
    expect(within(section).queryByText(/and \d+ more/)).toBeNull();
  });

  it("says that nothing waits", async () => {
    const section = await show({ waits: { total: 0, items: [] } });
    expect(within(section).getByText("Nothing waits for you in this scope.")).toBeInTheDocument();
  });

  it("shows a title with HTML and Markdown as text, with no element and no image", async () => {
    const title = '<img src="https://evil.test/x.png"> **bold** [a](https://evil.test)';
    const section = await show({ waits: { total: 1, items: [item({ title })] } });
    expect(within(section).getByText(title)).toBeInTheDocument();
    expect(section.querySelector("img, b, strong a")).toBeNull();
    expect(within(section).getAllByRole("link")).toHaveLength(1);
  });

  it("gives no link for an item with no link or a link that is not a web address", async () => {
    const section = await show({
      waits: {
        total: 2,
        items: [item({ number: 1, link: null }), item({ number: 2, link: "javascript:alert(1)" })],
      },
    });
    expect(within(section).queryByRole("link")).toBeNull();
  });

  it("says that nothing is connected", async () => {
    const section = await show({ waits: null, pipeline: null });
    expect(section).toHaveTextContent(
      "Not connected. Add the Foreman token to FOREMAN_TOKENS_JSON",
    );
  });

  it("says that the data is not complete when a repo is not connected", async () => {
    const section = await show({
      waits: { total: 0, items: [] },
      complete: { connectedRepos: 1, missingRepos: 2 },
    });
    expect(section).toHaveTextContent("Data is not complete: 2 repos not connected. See Repos.");
  });
});

describe("the dash and Waits for you", () => {
  it("shows the same number in the tile and the list total", async () => {
    const items = Array.from({ length: 20 }, (_, index) => item({ number: index + 1 }));
    fakeApi({
      dash: { waits: { total: 30, items }, tiles: { ...quietDash.tiles, waits: 30 } },
    });
    renderApp();
    const tile = (await screen.findByText("Waits for you", { selector: ".tile-label" })).closest(
      "li",
    );
    expect(tile).toHaveTextContent("30");
  });
});
