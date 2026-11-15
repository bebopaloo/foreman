import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

export interface ListPage<Row> {
  items: Row[];
  nextCursor: string | null;
}

export interface PagedListOptions<Row, Page extends ListPage<Row> = ListPage<Row>> {
  queryKey: QueryKey;
  /** Loads one page. A null cursor asks for the first page. The caller validates the response. */
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page>;
  /** Asks again for the loaded pages at this interval, in milliseconds. A hidden tab does not ask. */
  refetchInterval?: number | false;
  /** False stops the list from loading. The default is true. */
  enabled?: boolean;
  /** Decides whether a failed request is tried again. The default is the query client's rule. */
  retry?: (failureCount: number, error: Error) => boolean;
}

/**
 * A paged list. A refetch (a live update) asks again for the first page with no
 * cursor, then for as many more pages as were loaded, each with the new
 * `nextCursor`. The old rows stay on show until all of those pages arrive.
 */
export function usePagedList<Row, Page extends ListPage<Row> = ListPage<Row>>({
  queryKey,
  fetchPage,
  refetchInterval = false,
  enabled = true,
  retry,
}: PagedListOptions<Row, Page>) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval,
    refetchIntervalInBackground: false,
    enabled,
    ...(retry === undefined ? {} : { retry }),
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
    error: query.error,
    /** The first page as the caller's own type, for the values that the page holds beside its rows. */
    firstPage: query.data?.pages[0],
    isLoadingMore: query.isFetchingNextPage,
    showMore,
    refresh: query.refetch,
  };
}

export type PagedList<Row, Page extends ListPage<Row> = ListPage<Row>> = ReturnType<
  typeof usePagedList<Row, Page>
>;
