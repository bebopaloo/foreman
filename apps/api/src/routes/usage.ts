import { type Database, schema } from "@foreman/db";
import { ProjectsQuery, ProjectsResponse, RefreshStatusResponse } from "@foreman/shared";
import { eq, max, min } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { originGuard } from "../host-check.ts";
import { labelProjects, projectId } from "../usage/projects.ts";
import type { Refresher } from "../usage/refresh.ts";

export interface UsageOptions {
  db: Database;
  refresher: Refresher;
  /** The origins that may send a refresh request. */
  allowedOrigins: readonly string[];
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const usageRoutes: FastifyPluginCallbackZod<UsageOptions> = (
  app,
  { db, refresher, allowedOrigins },
  done,
) => {
  app.get(
    "/status",
    { config: { public: true }, schema: { response: { 200: RefreshStatusResponse } } },
    () => refresher.status(),
  );

  // The refresh runs in the background: the request never waits for it.
  app.post(
    "/refresh",
    {
      config: { public: true },
      onRequest: originGuard(allowedOrigins),
      schema: { response: { 202: RefreshStatusResponse } },
    },
    async (_request, reply) => {
      void refresher.trigger();
      return reply.status(202).send(await refresher.status());
    },
  );

  app.get(
    "/projects",
    {
      config: { public: true },
      schema: { querystring: ProjectsQuery, response: { 200: ProjectsResponse } },
    },
    async (request) => {
      const rows = await db
        .select({
          key: schema.turns.projectKey,
          noRepo: schema.projects.noRepo,
          first: min(schema.turns.time),
          last: max(schema.turns.time),
        })
        .from(schema.turns)
        .leftJoin(schema.projects, eq(schema.projects.projectKey, schema.turns.projectKey))
        .groupBy(schema.turns.projectKey, schema.projects.noRepo);
      const refs = rows.map((row) => ({ key: row.key, noRepo: row.noRepo ?? false }));
      const labels = labelProjects(refs);
      const projects = rows.flatMap((row) =>
        row.first === null || row.last === null
          ? []
          : [
              {
                id: projectId(row.key),
                label: labels.get(row.key) ?? row.key,
                noRepo: row.noRepo ?? false,
                firstTurnAt: row.first.toISOString(),
                lastTurnAt: row.last.toISOString(),
              },
            ],
      );
      projects.sort((a, b) => b.lastTurnAt.localeCompare(a.lastTurnAt) || a.id.localeCompare(b.id));
      return { projects: projects.slice(0, request.query.limit) };
    },
  );
  done();
};
