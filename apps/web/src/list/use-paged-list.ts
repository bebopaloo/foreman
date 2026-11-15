import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

export interface ListPage<Row> {
  items: Row[];
  nextCursor: string | null;
}

export interface PagedListOptions<Row, Page extends ListPage<Row> = ListPage<Row>> {
  queryKey: QueryKey;
  /** Loads one page. A null cursor asks for the first page. The caller validates the response. */
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page>;
  /** False holds all requests, for a view that is not ready to ask. The default is true. */
  enabled?: boolean;
  /** A live update: ask again each so many milliseconds while the tab is visible. */
  refetchMs?: number;
}

/**
 * A paged list. A refetch (a live update) asks again for the first page with no
 * cursor, then for as many more pages as were loaded, each with the new
 * `nextCursor`. The old rows stay on show until all of those pages arrive.
 */
export function usePagedList<Row, Page extends ListPage<Row> = ListPage<Row>>({
  queryKey,
  fetchPage,
  enabled = true,
  refetchMs,
}: PagedListOptions<Row, Page>) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    refetchInterval: refetchMs ?? false,
    refetchIntervalInBackground: false,
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
    /** The newest first page, which can hold more than the rows: counts and notes of the view. */
    firstPage: query.data?.pages[0],
    hasMore: query.hasNextPage,
    isPending: query.isPending,
    isError: query.isError,
    isLoadingMore: query.isFetchingNextPage,
    showMore,
    refresh: query.refetch,
  };
}

export type PagedList<Row, Page extends ListPage<Row> = ListPage<Row>> = ReturnType<
  typeof usePagedList<Row, Page>
>;
