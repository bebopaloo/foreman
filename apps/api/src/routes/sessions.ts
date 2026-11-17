import type { Database } from "@foreman/db";
import {
  SessionParams,
  SessionQuery,
  SessionResponse,
  SessionsQuery,
  SessionsResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { querySession } from "../sessions/session.ts";
import { querySessions } from "../sessions/sessions.ts";
import { clientProjectKeys } from "../work/clients.ts";
import { readRepoList } from "../work/repo-list.ts";
import { resolveWorkScope } from "../work/scope.ts";
import { readTokens, type TokenSource } from "../work/tokens.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface SessionsOptions {
  db: Database;
  /** The folder of the repo list, which names the client of each Project. */
  claudeDir: string;
  /** The tokens file. A repo of an owner with no token shows no title and no link. */
  tokenSource: TokenSource;
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const sessionsRoutes: FastifyPluginCallbackZod<SessionsOptions> = (
  app,
  { db, claudeDir, tokenSource },
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

  app.get(
    "/:sessionId",
    {
      config: { public: true },
      schema: {
        params: SessionParams,
        querystring: SessionQuery,
        response: { 200: SessionResponse, 400: RejectedResponse, 404: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { day, tz, client, limit, cursor } = request.query;
      const list = await readRepoList(claudeDir);
      const entries = list.status === "ok" ? list.repos : [];
      let clientKeys: string[] | null = null;
      if (client !== undefined) {
        clientKeys = clientProjectKeys(entries, client);
        if (clientKeys === null) {
          return reply.status(400).send({ error: "Unknown client", requestId: request.id });
        }
      }
      const scope = resolveWorkScope(entries, await readTokens(tokenSource), client, undefined);
      const response = await querySession(db, {
        sessionId,
        day,
        tz,
        clientKeys,
        limit,
        cursor,
        cursorQuery: { day, tz, client },
        entries,
        scopeEntries: client === undefined ? entries : entries.filter((e) => e.client === client),
        readable: scope.ok ? scope.repos : [],
      });
      if (response === null) {
        return reply.status(404).send({ error: "No such session", requestId: request.id });
      }
      return response;
    },
  );
  done();
};
