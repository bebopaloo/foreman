import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { pageQueryShape, pageResponseSchema } from "@foreman/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InvalidCursorError, paginate, type CursorKey } from "../src/paging.ts";

const numbers = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
const keyOf = (row: { id: number }): CursorKey => [row.id];
const compare = (a: CursorKey, b: CursorKey): number => Number(a[0]) - Number(b[0]);

function build() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof InvalidCursorError || (error instanceof Error && "validation" in error)
        ? 400
        : 500;
    return reply.status(status).send({ error: "Bad request" });
  });
  app.get(
    "/list",
    {
      schema: {
        querystring: z
          .object({
            ...pageQueryShape({ defaultLimit: 3, maxLimit: 5 }),
            client: z.string().optional(),
          })
          .strict(),
        response: { 200: pageResponseSchema(z.object({ id: z.number() }).strict()) },
      },
    },
    (request) =>
      paginate(numbers, {
        limit: request.query.limit,
        cursor: request.query.cursor,
        query: { client: request.query.client },
        keyOf,
        compare,
      }),
  );
  return app;
}

describe("a list route with the paging helpers", () => {
  const app = build();

  async function get(url: string) {
    const response = await app.inject({ method: "GET", url });
    return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
  }

  it("uses the default limit and walks all pages", async () => {
    const first = await get("/list");
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(3);
    const cursor = first.body.nextCursor as string;
    const second = await get(`/list?cursor=${cursor}&limit=5`);
    expect(second.body.items).toEqual(numbers.slice(3));
    expect(second.body.nextCursor).toBeNull();
  });

  it("gets status 400 for a limit below 1 or above the maximum", async () => {
    expect((await get("/list?limit=0")).status).toBe(400);
    expect((await get("/list?limit=6")).status).toBe(400);
    expect((await get("/list?limit=5")).status).toBe(200);
  });

  it("gets status 400 for a cursor that does not decode", async () => {
    expect((await get("/list?cursor=!!!")).status).toBe(400);
  });

  it("gets status 400 for a cursor of another query", async () => {
    const first = await get("/list?client=acme&limit=2");
    const cursor = first.body.nextCursor as string;
    expect((await get(`/list?client=other&cursor=${cursor}`)).status).toBe(400);
    expect((await get(`/list?cursor=${cursor}`)).status).toBe(400);
    expect((await get(`/list?client=acme&cursor=${cursor}`)).status).toBe(200);
  });
});
