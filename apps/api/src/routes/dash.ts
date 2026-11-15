import type { Database } from "@foreman/db";
import { DashQuery, DashResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { buildDash, readDashSources } from "../dash/dash.ts";

export interface DashOptions {
  db: Database;
  claudeDir: string;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

export const dashRoutes: FastifyPluginCallbackZod<DashOptions> = (
  app,
  { db, claudeDir, now = () => new Date() },
  done,
) => {
  // Public for the same reason as the Usage routes: Foreman binds to 127.0.0.1 and has no sign-in.
  app.get(
    "/dash",
    {
      config: { public: true },
      schema: { querystring: DashQuery, response: { 200: DashResponse } },
    },
    async (request) => {
      const at = now();
      const { client } = request.query;
      const { response, reports } = buildDash(
        await readDashSources(claudeDir, at, db),
        client === undefined ? { kind: "all" } : { kind: "client", client },
        at,
      );
      for (const { folder, files } of reports) {
        for (const { file, lines } of files) {
          request.log.warn(
            { folder, file, skippedLines: lines },
            lines === 0 ? "dash skipped a file" : "dash skipped lines",
          );
        }
      }
      return response;
    },
  );
  done();
};
