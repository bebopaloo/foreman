import { z } from "zod";

const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type CursorScalar = z.infer<typeof Scalar>;

/** The sort key of a row: the values of its total order, the unique last key included. */
export type CursorKey = readonly CursorScalar[];

/** The query values that decide the rows and their order, the client and the sort among them. */
export type CursorQuery = Readonly<Record<string, CursorScalar | undefined>>;

const CursorPayload = z
  .object({
    key: z.array(Scalar).min(1),
    query: z.record(z.string(), Scalar),
  })
  .strict();

export class InvalidCursorError extends Error {
  readonly statusCode = 400;

  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
    this.name = "InvalidCursorError";
  }
}

function definedEntries(query: CursorQuery): [string, CursorScalar][] {
  const entries: [string, CursorScalar][] = [];
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      entries.push([name, value]);
    }
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function canonical(query: CursorQuery): string {
  return JSON.stringify(definedEntries(query));
}

export function encodeCursor(key: CursorKey, query: CursorQuery): string {
  const payload = { key: [...key], query: Object.fromEntries(definedEntries(query)) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns the sort key. Throws `InvalidCursorError` (status 400) for any cursor that is not valid for this query. */
export function decodeCursor(cursor: string, query: CursorQuery): CursorKey {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidCursorError("not base64url");
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("not JSON");
  }
  const parsed = CursorPayload.safeParse(json);
  if (!parsed.success) {
    throw new InvalidCursorError("wrong shape");
  }
  if (canonical(parsed.data.query) !== canonical(query)) {
    throw new InvalidCursorError("from another query");
  }
  return parsed.data.key;
}

export interface PagingOptions<Row> {
  limit: number;
  cursor: string | undefined;
  query: CursorQuery;
  keyOf: (row: Row) => CursorKey;
  /** The total order of the keys. Returns a number below 0, 0 or above 0. */
  compare: (a: CursorKey, b: CursorKey) => number;
}

export interface Page<Row> {
  items: Row[];
  nextCursor: string | null;
}

/** Pages rows that are already sorted by the total order of `compare`. */
export function paginate<Row>(rows: readonly Row[], options: PagingOptions<Row>): Page<Row> {
  const { limit, cursor, query, keyOf, compare } = options;
  let start = 0;
  if (cursor !== undefined) {
    const after = decodeCursor(cursor, query);
    start = rows.findIndex((row) => compare(keyOf(row), after) > 0);
    if (start === -1) {
      start = rows.length;
    }
  }
  const items = rows.slice(start, start + limit);
  const last = items.at(-1);
  const hasMore = start + limit < rows.length;
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last), query) : null,
  };
}
