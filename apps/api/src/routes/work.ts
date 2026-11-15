import path from "node:path";
import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import { WorkClientsResponse, WorkReposResponse, WorkStatusResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { originGuard } from "../host-check.ts";
import { listClients } from "../work/clients.ts";
import { readRepoList, type RepoEntry } from "../work/repo-list.ts";
import type { FetchSchedule } from "../work/schedule.ts";
import { readWorkStatus } from "../work/status.ts";

export interface WorkOptions {
  db: Database;
  claudeDir: string;
  schedule: FetchSchedule;
  /** The origins that may send a refresh request. */
  allowedOrigins: readonly string[];
}

async function currentRepos(claudeDir: string): Promise<RepoEntry[]> {
  const list = await readRepoList(claudeDir);
  return list.status === "ok" ? list.repos : [];
}

export const workRoutes: FastifyPluginCallbackZod<WorkOptions> = (
  app,
  { db, claudeDir, schedule, allowedOrigins },
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
      void schedule.trigger();
      return reply.status(202).send(await readWorkStatus(db, claudeDir, schedule));
    },
  );

  done();
};
