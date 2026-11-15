import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  paginate,
  type CursorKey,
} from "./paging.ts";

interface Row {
  repo: string;
  number: number;
}

const rows: Row[] = [
  { repo: "a", number: 3 },
  { repo: "a", number: 2 },
  { repo: "a", number: 1 },
  { repo: "b", number: 5 },
  { repo: "b", number: 4 },
];
const query = { client: "acme", sort: "repo" };
const keyOf = (row: Row): CursorKey => [row.repo, row.number];
// repo ascending, then number descending
const compare = (a: CursorKey, b: CursorKey): number => {
  if (a[0] !== b[0]) {
    return String(a[0]) < String(b[0]) ? -1 : 1;
  }
  return Number(b[1]) - Number(a[1]);
};
const options = { query, keyOf, compare };

function raw(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("cursor codec", () => {
  it("is base64url of a JSON object with the sort key and the query values", () => {
    const cursor = encodeCursor(["a", 1], query);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).toEqual({
      key: ["a", 1],
      query,
    });
  });

  it("round-trips the sort key", () => {
    expect(decodeCursor(encodeCursor(["a", 1, null, true], query), query)).toEqual([
      "a",
      1,
      null,
      true,
    ]);
  });

  it("ignores the order of the query names and the undefined values", () => {
    const cursor = encodeCursor(["a", 1], { sort: "repo", client: "acme", repo: undefined });
    expect(decodeCursor(cursor, query)).toEqual(["a", 1]);
  });

  it.each([
    ["is not base64url", "not a cursor!"],
    ["is not JSON", Buffer.from("{oops", "utf8").toString("base64url")],
    ["is JSON of the wrong shape", raw(["a"])],
    ["has an empty sort key", raw({ key: [], query })],
    ["has a sort key that is not scalar", raw({ key: [{}], query })],
    ["has an unknown field", raw({ key: ["a"], query, extra: 1 })],
    ["has no query", raw({ key: ["a"] })],
  ])("rejects a cursor that %s", (_name, cursor) => {
    expect(() => decodeCursor(cursor, query)).toThrow(InvalidCursorError);
  });

  it("rejects a cursor of another client", () => {
    const cursor = encodeCursor(["a", 1], { ...query, client: "other" });
    expect(() => decodeCursor(cursor, query)).toThrow(InvalidCursorError);
  });

  it("rejects a cursor of another sort or another filter", () => {
    expect(() => decodeCursor(encodeCursor(["a", 1], { ...query, sort: "state" }), query)).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeCursor(encodeCursor(["a", 1], { ...query, repo: "x" }), query)).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeCursor(encodeCursor(["a", 1], { client: "acme" }), query)).toThrow(
      InvalidCursorError,
    );
  });

  it("gives the error the status 400", () => {
    expect(new InvalidCursorError("x").statusCode).toBe(400);
  });
});

describe("paginate", () => {
  it("returns the first page and a cursor while rows remain", () => {
    const page = paginate(rows, { ...options, limit: 2, cursor: undefined });
    expect(page.items).toEqual(rows.slice(0, 2));
    expect(page.nextCursor).not.toBeNull();
  });

  it("has nextCursor null when all rows fit in the page", () => {
    expect(paginate(rows, { ...options, limit: 5, cursor: undefined }).nextCursor).toBeNull();
    expect(paginate(rows, { ...options, limit: 500, cursor: undefined }).nextCursor).toBeNull();
  });

  it("has nextCursor null on the last page and shows no row twice", () => {
    const seen: Row[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = paginate(rows, { ...options, limit: 2, cursor });
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(seen).toEqual(rows);
  });

  it("returns an empty last page for no rows", () => {
    expect(paginate([], { ...options, limit: 10, cursor: undefined })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("continues after a row that left the list", () => {
    const cursor = encodeCursor(["a", 2], query);
    const page = paginate(
      rows.filter((row) => row.number !== 2),
      { ...options, limit: 10, cursor },
    );
    expect(page.items.map(keyOf)).toEqual([
      ["a", 1],
      ["b", 5],
      ["b", 4],
    ]);
  });

  it("returns an empty page for a cursor past the last row", () => {
    const cursor = encodeCursor(["z", 1], query);
    expect(paginate(rows, { ...options, limit: 10, cursor })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("throws for a cursor of another query", () => {
    const cursor = encodeCursor(["a", 3], { client: "other", sort: "repo" });
    expect(() => paginate(rows, { ...options, limit: 2, cursor })).toThrow(InvalidCursorError);
  });
});
