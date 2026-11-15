import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NextCursor, pageQueryShape, pageResponseSchema } from "./paging.ts";

const Query = z
  .object({ ...pageQueryShape({ defaultLimit: 100, maxLimit: 500 }), repo: z.string().optional() })
  .strict();

describe("pageQueryShape", () => {
  it("uses the default limit when the query has none", () => {
    expect(Query.parse({}).limit).toBe(100);
  });

  it("reads limit from a query string value", () => {
    expect(Query.parse({ limit: "25" }).limit).toBe(25);
  });

  it("accepts the limit 1 and the maximum limit", () => {
    expect(Query.parse({ limit: "1" }).limit).toBe(1);
    expect(Query.parse({ limit: "500" }).limit).toBe(500);
  });

  it.each(["0", "-1", "501", "1.5", "abc", ""])("rejects the limit %j", (limit) => {
    expect(Query.safeParse({ limit }).success).toBe(false);
  });

  it("names the default and the maximum for each route", () => {
    const small = z.object(pageQueryShape({ defaultLimit: 20, maxLimit: 50 })).strict();
    expect(small.parse({}).limit).toBe(20);
    expect(small.safeParse({ limit: "51" }).success).toBe(false);
    expect(small.safeParse({ limit: "50" }).success).toBe(true);
  });

  it("keeps the cursor optional and rejects an empty cursor", () => {
    expect(Query.parse({}).cursor).toBeUndefined();
    expect(Query.parse({ cursor: "abc" }).cursor).toBe("abc");
    expect(Query.safeParse({ cursor: "" }).success).toBe(false);
  });

  it("rejects unknown fields in a strict route schema", () => {
    expect(Query.safeParse({ other: "1" }).success).toBe(false);
  });

  it("rejects limits that do not fit together", () => {
    expect(() => pageQueryShape({ defaultLimit: 0, maxLimit: 10 })).toThrow(RangeError);
    expect(() => pageQueryShape({ defaultLimit: 11, maxLimit: 10 })).toThrow(RangeError);
    expect(() => pageQueryShape({ defaultLimit: 1.5, maxLimit: 10 })).toThrow(RangeError);
  });
});

describe("page response", () => {
  const Response = pageResponseSchema(z.object({ id: z.number() }).strict());

  it("has nextCursor null on the last page", () => {
    expect(Response.parse({ items: [{ id: 1 }], nextCursor: null }).nextCursor).toBeNull();
  });

  it("has a string nextCursor on another page", () => {
    expect(Response.parse({ items: [], nextCursor: "abc" }).nextCursor).toBe("abc");
  });

  it("requires the nextCursor field and rejects an empty one", () => {
    expect(Response.safeParse({ items: [] }).success).toBe(false);
    expect(NextCursor.safeParse("").success).toBe(false);
  });
});
