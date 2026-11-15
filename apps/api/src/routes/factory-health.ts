import { PluginVersionsQuery, PluginVersionsResponse } from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { readPluginVersions } from "../factory-health/plugins.ts";
import { paginate } from "../paging.ts";

export interface FactoryHealthOptions {
  claudeDir: string;
  /** The folder of the one `directory` Marketplace that Foreman may read. */
  marketplaceDir: string | undefined;
}

export const factoryHealthRoutes: FastifyPluginCallbackZod<FactoryHealthOptions> = (
  app,
  { claudeDir, marketplaceDir },
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

  done();
};
