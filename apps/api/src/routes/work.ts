import path from "node:path";
import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import {
  WorkClientsResponse,
  WorkIssuesQuery,
  WorkIssuesResponse,
  WorkPullRequestsQuery,
  WorkPullRequestsResponse,
  WorkReleasesQuery,
  WorkReleasesResponse,
  WorkReposResponse,
  WorkStatusResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { originGuard } from "../host-check.ts";
import { listClients } from "../work/clients.ts";
import { listIssues, listPullRequests, listReleases } from "../work/lists.ts";
import { readRepoList, type RepoEntry } from "../work/repo-list.ts";
import { resolveWorkScope } from "../work/scope.ts";
import type { FetchSchedule } from "../work/schedule.ts";
import { readWorkStatus } from "../work/status.ts";
import { readTokens } from "../work/tokens.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface WorkOptions {
  db: Database;
  claudeDir: string;
  schedule: FetchSchedule;
  /** The tokens file. A repo of an owner with no token returns no data. */
  tokensFile: string | undefined;
  /** The origins that may send a refresh request. */
  allowedOrigins: readonly string[];
}

async function currentRepos(claudeDir: string): Promise<RepoEntry[]> {
  const list = await readRepoList(claudeDir);
  return list.status === "ok" ? list.repos : [];
}

export const workRoutes: FastifyPluginCallbackZod<WorkOptions> = (
  app,
  { db, claudeDir, schedule, tokensFile, allowedOrigins },
  done,
) => {
  app.get(
    "/work/clients",
    { config: { public: true }, schema: { response: { 200: WorkClientsResponse } } },
    async () => listClients(await currentRepos(claudeDir)),
  );

  app.get(
    "/work/repos",
    { config: { public: true }, schema: { response: { 200: WorkReposResponse } } },
    async () => {
      const repos = await currentRepos(claudeDir);
      const cached = await db
        .select({
          id: schema.workRepos.id,
          forgeState: schema.workRepos.forgeState,
          lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
        })
        .from(schema.workRepos);
      const byId = new Map(cached.map((row) => [row.id, row]));
      return {
        repos: repos
          .map((repo) => {
            const row = byId.get(repo.id);
            return {
              id: repo.id,
              fullName:
                repo.owner === null || repo.name === null
                  ? path.basename(repo.path)
                  : `${repo.owner}/${repo.name}`,
              host: repo.host,
              client: repo.client,
              state:
                repo.owner === null ? "not connected: no forge name" : (row?.forgeState ?? null),
              dataAsOf: row?.lastGoodFetchAt?.toISOString() ?? null,
            };
          })
          .sort((a, b) => (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0)),
      };
    },
  );

  async function scopeOf(client: string | undefined, repo: string | undefined) {
    const list = await readRepoList(claudeDir);
    const entries = list.status === "ok" ? list.repos : [];
    return resolveWorkScope(entries, await readTokens(tokensFile), client, repo);
  }

  app.get(
    "/work/issues",
    {
      config: { public: true },
      schema: {
        querystring: WorkIssuesQuery,
        response: { 200: WorkIssuesResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, issue_state, state, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      return listIssues(
        db,
        scope.repos,
        { issue_state, state },
        { limit, cursor, query: { client, repo, issue_state, state } },
      );
    },
  );

  app.get(
    "/work/pull-requests",
    {
      config: { public: true },
      schema: {
        querystring: WorkPullRequestsQuery,
        response: { 200: WorkPullRequestsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      return listPullRequests(db, scope.repos, { limit, cursor, query: { client, repo } });
    },
  );

  app.get(
    "/work/releases",
    {
      config: { public: true },
      schema: {
        querystring: WorkReleasesQuery,
        response: { 200: WorkReleasesResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      return listReleases(db, scope.repos, { limit, cursor, query: { client, repo } });
    },
  );

  app.get(
    "/work/status",
    { config: { public: true }, schema: { response: { 200: WorkStatusResponse } } },
    () => readWorkStatus(db, claudeDir, schedule),
  );

  // The fetch runs in the background: the request never waits for it.
  app.post(
    "/work/refresh",
    {
      config: { public: true },
      onRequest: originGuard(allowedOrigins),
      schema: { response: { 202: WorkStatusResponse } },
    },
    async (_request, reply) => {
      void schedule.trigger({ refresh: true });
      return reply.status(202).send(await readWorkStatus(db, claudeDir, schedule));
    },
  );

  done();
};
