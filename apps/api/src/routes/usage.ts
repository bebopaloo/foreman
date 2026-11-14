import { type Database, schema } from "@foreman/db";
import { ProjectsQuery, ProjectsResponse } from "@foreman/shared";
import { eq, max, min } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { labelProjects, projectId } from "../usage/projects.ts";

export interface UsageOptions {
  db: Database;
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const usageRoutes: FastifyPluginCallbackZod<UsageOptions> = (app, { db }, done) => {
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
