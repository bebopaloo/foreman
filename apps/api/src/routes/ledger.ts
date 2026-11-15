import type { Database } from "@foreman/db";
import { LedgerQuery, LedgerResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { InteractiveTimeRules } from "../ledger/interactive-time.ts";
import { firstOfMonth, ledgerToday, queryLedger } from "../ledger/ledger.ts";
import { clientProjectKeys } from "../work/clients.ts";
import { readRepoList } from "../work/repo-list.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface LedgerOptions {
  db: Database;
  /** The folder of the repo list, which names the client and the label of each Project. */
  claudeDir: string;
  rules: InteractiveTimeRules;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

// Foreman has no sign-in: the loopback bind and the Host check are its access control.
export const ledgerRoutes: FastifyPluginCallbackZod<LedgerOptions> = (
  app,
  { db, claudeDir, rules, now = () => new Date() },
  done,
) => {
  app.get(
    "/",
    {
      config: { public: true },
      schema: {
        querystring: LedgerQuery,
        response: { 200: LedgerResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, limit, cursor } = request.query;
      const list = await readRepoList(claudeDir);
      const repos = list.status === "ok" ? list.repos : [];
      let scopeKeys: string[] | null = null;
      if (client !== undefined) {
        scopeKeys = clientProjectKeys(repos, client);
        if (scopeKeys === null) {
          return reply.status(400).send({ error: "Unknown client", requestId: request.id });
        }
      }
      const today = ledgerToday(now(), rules.timeZone);
      const from = request.query.from ?? firstOfMonth(today);
      const to = request.query.to ?? today;
      return queryLedger(db, { rules, repos, from, to, scopeKeys, client, limit, cursor });
    },
  );
  done();
};
