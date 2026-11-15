import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

export interface ListPage<Row> {
  items: Row[];
  nextCursor: string | null;
}

export interface PagedListOptions<Row> {
  queryKey: QueryKey;
  /** Loads one page. A null cursor asks for the first page. The caller validates the response. */
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<ListPage<Row>>;
}

/**
 * A paged list. A refetch (a live update) asks again for the first page with no
 * cursor, then for as many more pages as were loaded, each with the new
 * `nextCursor`. The old rows stay on show until all of those pages arrive.
 */
export function usePagedList<Row>({ queryKey, fetchPage }: PagedListOptions<Row>) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];

  async function showMore(): Promise<number> {
    const before = rows.length;
    const result = await query.fetchNextPage();
    if (result.isError) {
      return 0;
    }
    const after = result.data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? before;
    return Math.max(after - before, 0);
  }

  return {
    rows,
    hasMore: query.hasNextPage,
    isPending: query.isPending,
    isError: query.isError,
    isLoadingMore: query.isFetchingNextPage,
    showMore,
    refresh: query.refetch,
  };
}

export type PagedList<Row> = ReturnType<typeof usePagedList<Row>>;
