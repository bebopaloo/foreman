import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShowMoreList } from "./ShowMoreList.tsx";
import { usePagedList, type ListPage } from "./use-paged-list.ts";

interface Row {
  id: string;
}

function makeSource(total: number, pageSize: number) {
  const calls: (string | null)[] = [];
  let version = "";
  const fetchPage = (cursor: string | null): Promise<ListPage<Row>> => {
    calls.push(cursor);
    const start = cursor === null ? 0 : Number(cursor);
    const end = Math.min(start + pageSize, total);
    return Promise.resolve({
      items: Array.from({ length: end - start }, (_, i) => ({
        id: `${version}row ${(start + i + 1).toString()}`,
      })),
      nextCursor: end < total ? end.toString() : null,
    });
  };
  return {
    calls,
    fetchPage,
    setVersion: (value: string) => {
      version = value;
    },
  };
}

function Harness({ fetchPage }: { fetchPage: (cursor: string | null) => Promise<ListPage<Row>> }) {
  const list = usePagedList<Row>({ queryKey: ["rows"], fetchPage });
  return (
    <ShowMoreList list={list} label="Rows" rowKey={(row) => row.id} renderRow={(row) => row.id} />
  );
}

function renderHarness(source: ReturnType<typeof makeSource>): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness fetchPage={source.fetchPage} />
    </QueryClientProvider>,
  );
  return client;
}

describe("ShowMoreList", () => {
  it("shows the first page and a Show more button", async () => {
    renderHarness(makeSource(5, 2));
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("adds the next page, focuses the first new row and says how many rows came", async () => {
    const user = userEvent.setup();
    renderHarness(makeSource(5, 2));
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
    });
    await waitFor(() => {
      expect(screen.getByText("row 3")).toHaveFocus();
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 more rows shown");
  });

  it("hides the button when nextCursor is null", async () => {
    const user = userEvent.setup();
    renderHarness(makeSource(3, 2));
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 more rows shown");
  });

  it("shows no button when the first page is the last page", async () => {
    renderHarness(makeSource(2, 2));
    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("reloads from page 1 for as many pages as were loaded on a live update", async () => {
    const user = userEvent.setup();
    const source = makeSource(5, 2);
    const client = renderHarness(source);
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
    });
    source.calls.length = 0;
    source.setVersion("new ");
    await client.invalidateQueries({ queryKey: ["rows"] });
    await waitFor(() => {
      expect(screen.getByText("new row 4")).toBeInTheDocument();
    });
    expect(source.calls).toEqual([null, "2"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("row 1")).not.toBeInTheDocument();
  });

  it("asks only for the first page on a live update when no more page was loaded", async () => {
    const source = makeSource(5, 2);
    const client = renderHarness(source);
    await screen.findAllByRole("listitem");
    source.calls.length = 0;
    await client.invalidateQueries({ queryKey: ["rows"] });
    expect(source.calls).toEqual([null]);
  });

  it("shows an alert when the next page does not load", async () => {
    const user = userEvent.setup();
    let fail = false;
    const base = makeSource(5, 2);
    const fetchPage = (cursor: string | null) =>
      fail && cursor !== null ? Promise.reject(new Error("down")) : base.fetchPage(cursor);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness fetchPage={fetchPage} />
      </QueryClientProvider>,
    );
    await screen.findAllByRole("listitem");
    fail = true;
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
