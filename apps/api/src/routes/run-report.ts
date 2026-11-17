import { RunReportParams, RunReportResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { readRunReport } from "../dash/run-report.ts";

export interface RunReportOptions {
  claudeDir: string;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

const NotFound = z.object({ error: z.string() }).strict();

export const runReportRoutes: FastifyPluginCallbackZod<RunReportOptions> = (
  app,
  { claudeDir, now = () => new Date() },
  done,
) => {
  // Public for the same reason as the dash: Foreman binds to 127.0.0.1 and has no sign-in.
  app.get(
    "/runs/:runId/report",
    {
      config: { public: true },
      schema: { params: RunReportParams, response: { 200: RunReportResponse, 404: NotFound } },
    },
    async (request, reply) => {
      const report = await readRunReport(claudeDir, request.params.runId, now());
      if (report === null) return reply.status(404).send({ error: "Run not found" });
      return report;
    },
  );
  done();
};
