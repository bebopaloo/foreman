import type { Database } from "@foreman/db";
import { HealthResponse } from "@foreman/shared";
import { sql } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { FOREMAN_VERSION } from "../version.ts";

export interface HealthOptions {
  db: Database;
}

export const healthRoutes: FastifyPluginCallbackZod<HealthOptions> = (app, { db }, done) => {
  app.get(
    "/health",
    {
      config: { public: true },
      schema: { response: { 200: HealthResponse, 503: HealthResponse } },
    },
    async (request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return { status: "ok" as const, version: FOREMAN_VERSION };
      } catch (error) {
        request.log.warn({ err: error }, "database check failed");
        return reply.status(503).send({ status: "unavailable", version: FOREMAN_VERSION });
      }
    },
  );
  done();
};
