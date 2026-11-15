import type { Database } from "@foreman/db";
import {
  FactoryRunsQuery,
  FactoryRunsResponse,
  PluginVersionsQuery,
  PluginVersionsResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { readPluginVersions } from "../factory-health/plugins.ts";
import { compareRunRows, readFactoryRuns } from "../factory-health/runs.ts";
import { paginate } from "../paging.ts";

export interface FactoryHealthOptions {
  claudeDir: string;
  /** The folder of the one `directory` Marketplace that Foreman may read. */
  marketplaceDir: string | undefined;
  db: Database;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

export const factoryHealthRoutes: FastifyPluginCallbackZod<FactoryHealthOptions> = (
  app,
  { claudeDir, marketplaceDir, db, now = () => new Date() },
  done,
) => {
  app.get(
    "/plugins",
    {
      config: { public: true },
      schema: { querystring: PluginVersionsQuery, response: { 200: PluginVersionsResponse } },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      const versions = await readPluginVersions({ claudeDir, marketplaceDir });
      const page = paginate(versions.rows, {
        limit,
        cursor,
        query: {},
        keyOf: (row) => [row.key],
        compare: (a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0),
      });
      request.log.info(
        {
          plugins: versions.rows.length,
          marketplaces: versions.marketplaces.length,
          skippedFiles: versions.skippedFiles,
        },
        "plugin versions read",
      );
      return {
        pluginData: versions.pluginData,
        marketplaces: versions.marketplaces,
        items: page.items,
        nextCursor: page.nextCursor,
        skipped: { files: versions.skippedFiles.length },
      };
    },
  );

  app.get(
    "/runs",
    {
      config: { public: true },
      schema: { querystring: FactoryRunsQuery, response: { 200: FactoryRunsResponse } },
    },
    async (request) => {
      const { client, limit, cursor } = request.query;
      const read = await readFactoryRuns({
        claudeDir,
        db,
        scope: client === undefined ? { kind: "all" } : { kind: "client", client },
        now: now(),
      });
      for (const { file, lines } of read.reports) {
        request.log.warn(
          { folder: "runs", file, skippedLines: lines },
          lines === 0 ? "factory health skipped a file" : "factory health skipped lines",
        );
      }
      const page = paginate(read.rows, {
        limit,
        cursor,
        query: { client },
        keyOf: (row) => [row.end, row.runId],
        compare: (a, b) =>
          compareRunRows(
            { end: String(a[0]), runId: String(a[1]) },
            { end: String(b[0]), runId: String(b[1]) },
          ),
      });
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        sources: read.sources,
        skipped: read.skipped,
      };
    },
  );

  done();
};
