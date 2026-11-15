import { type Database, schema } from "@foreman/db";
import {
  BreakdownQuery,
  BreakdownResponse,
  LimitsQuery,
  LimitsResponse,
  MAX_SERIES_BUCKETS,
  ProjectsQuery,
  ProjectsResponse,
  RefreshStatusResponse,
  SeriesQuery,
  SeriesResponse,
} from "@foreman/shared";
import { eq, inArray, max, min } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { originGuard } from "../host-check.ts";
import { clientProjectKeys } from "../work/clients.ts";
import { readRepoList } from "../work/repo-list.ts";
import { queryLimits } from "../usage/limits.ts";
import { labelProjects, projectId } from "../usage/projects.ts";
import { bucketStarts, findProjectKey, queryBreakdown, querySeries } from "../usage/queries.ts";
import type { PriceTable } from "../usage/prices.ts";
import type { Refresher } from "../usage/refresh.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface UsageOptions {
  db: Database;
  refresher: Refresher;
  /** The list prices, read at start-up. */
  priceTable: PriceTable;
  /** The folder of the repo list, which names the client of each Project. */
  claudeDir: string;
  /** The origins that may send a refresh request. */
  allowedOrigins: readonly string[];
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const usageRoutes: FastifyPluginCallbackZod<UsageOptions> = (
  app,
  { db, refresher, priceTable, claudeDir, allowedOrigins },
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
      schema: {
        querystring: ProjectsQuery,
        response: { 200: ProjectsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const clientKeys = await resolveClient(request.query.client);
      if (clientKeys === undefined) {
        return reply.status(400).send({ error: "Unknown client", requestId: request.id });
      }
      const rows = await db
        .select({
          key: schema.turns.projectKey,
          noRepo: schema.projects.noRepo,
          first: min(schema.turns.time),
          last: max(schema.turns.time),
        })
        .from(schema.turns)
        .leftJoin(schema.projects, eq(schema.projects.projectKey, schema.turns.projectKey))
        .where(clientKeys === null ? undefined : inArray(schema.turns.projectKey, clientKeys))
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
      const { grain, client, ...range } = request.query;
      if (bucketStarts(range.from, range.to, grain).length > MAX_SERIES_BUCKETS) {
        return reply.status(400).send({ error: "Too many buckets", requestId: request.id });
      }
      const scope = await resolveScope(range.project, client);
      if (typeof scope === "string") {
        return reply.status(400).send({ error: scope, requestId: request.id });
      }
      return querySeries(db, priceTable, range, grain, scope.projectKey, scope.clientKeys);
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
      const { dimension, limit, client, ...range } = request.query;
      const scope = await resolveScope(range.project, client);
      if (typeof scope === "string") {
        return reply.status(400).send({ error: scope, requestId: request.id });
      }
      return queryBreakdown(
        db,
        priceTable,
        range,
        dimension,
        limit,
        scope.projectKey,
        scope.clientKeys,
      );
    },
  );

  app.get(
    "/limits",
    {
      config: { public: true },
      schema: { querystring: LimitsQuery, response: { 200: LimitsResponse } },
    },
    (request) => queryLimits(db, request.query),
  );

  /** The Project key for an ID, null for no filter, undefined for an unknown ID. */
  async function resolveProject(id: string | undefined): Promise<string | null | undefined> {
    if (id === undefined) return null;
    return (await findProjectKey(db, id)) ?? undefined;
  }

  /** The Project keys of a client, null for "All", undefined for a client that is not in the repo list. */
  async function resolveClient(client: string | undefined): Promise<string[] | null | undefined> {
    if (client === undefined) return null;
    const list = await readRepoList(claudeDir);
    if (list.status !== "ok") return undefined;
    return clientProjectKeys(list.repos, client) ?? undefined;
  }

  /** The filters of a request, or the text of the error when the request names an unknown or foreign scope. */
  async function resolveScope(
    project: string | undefined,
    client: string | undefined,
  ): Promise<{ projectKey: string | null; clientKeys: string[] | null } | string> {
    const clientKeys = await resolveClient(client);
    if (clientKeys === undefined) return "Unknown client";
    const projectKey = await resolveProject(project);
    if (projectKey === undefined) return "Unknown Project";
    if (projectKey !== null && clientKeys !== null && !clientKeys.includes(projectKey)) {
      return "Project outside the client";
    }
    return { projectKey, clientKeys };
  }
  done();
};
