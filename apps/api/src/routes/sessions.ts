import type { Database } from "@foreman/db";
import { SessionsQuery, SessionsResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { querySessions } from "../sessions/sessions.ts";
import { clientProjectKeys } from "../work/clients.ts";
import { readRepoList } from "../work/repo-list.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface SessionsOptions {
  db: Database;
  /** The folder of the repo list, which names the client of each Project. */
  claudeDir: string;
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const sessionsRoutes: FastifyPluginCallbackZod<SessionsOptions> = (
  app,
  { db, claudeDir },
  done,
) => {
  app.get(
    "/",
    {
      config: { public: true },
      schema: {
        querystring: SessionsQuery,
        response: { 200: SessionsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { day, tz, client, limit, cursor } = request.query;
      let clientKeys: string[] | null = null;
      if (client !== undefined) {
        const list = await readRepoList(claudeDir);
        clientKeys = list.status === "ok" ? clientProjectKeys(list.repos, client) : null;
        if (clientKeys === null) {
          return reply.status(400).send({ error: "Unknown client", requestId: request.id });
        }
      }
      return querySessions(db, {
        day,
        tz,
        clientKeys,
        limit,
        cursor,
        cursorQuery: { day, tz, client },
      });
    },
  );
  done();
};
