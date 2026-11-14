import { type Database, schema } from "@foreman/db";
import {
  BreakdownQuery,
  BreakdownResponse,
  MAX_SERIES_BUCKETS,
  ProjectsQuery,
  ProjectsResponse,
  RefreshStatusResponse,
  SeriesQuery,
  SeriesResponse,
} from "@foreman/shared";
import { eq, max, min } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { originGuard } from "../host-check.ts";
import { labelProjects, projectId } from "../usage/projects.ts";
import { bucketStarts, findProjectKey, queryBreakdown, querySeries } from "../usage/queries.ts";
import type { Refresher } from "../usage/refresh.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

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

  app.get(
    "/series",
    {
      config: { public: true },
      schema: {
        querystring: SeriesQuery,
        response: { 200: SeriesResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { grain, ...range } = request.query;
      if (bucketStarts(range.from, range.to, grain).length > MAX_SERIES_BUCKETS) {
        return reply.status(400).send({ error: "Too many buckets", requestId: request.id });
      }
      const projectKey = await resolveProject(range.project);
      if (projectKey === undefined) {
        return reply.status(400).send({ error: "Unknown Project", requestId: request.id });
      }
      return { buckets: await querySeries(db, range, grain, projectKey) };
    },
  );

  app.get(
    "/breakdown",
    {
      config: { public: true },
      schema: {
        querystring: BreakdownQuery,
        response: { 200: BreakdownResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { dimension, limit, ...range } = request.query;
      const projectKey = await resolveProject(range.project);
      if (projectKey === undefined) {
        return reply.status(400).send({ error: "Unknown Project", requestId: request.id });
      }
      return queryBreakdown(db, range, dimension, limit, projectKey);
    },
  );

  /** The Project key for an ID, null for no filter, undefined for an unknown ID. */
  async function resolveProject(id: string | undefined): Promise<string | null | undefined> {
    if (id === undefined) return null;
    return (await findProjectKey(db, id)) ?? undefined;
  }
  done();
};
