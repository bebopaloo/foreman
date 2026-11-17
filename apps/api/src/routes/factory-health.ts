import type { Database } from "@foreman/db";
import { schema } from "@foreman/db";
import {
  FactoryRunsQuery,
  FactoryRunsResponse,
  PluginVersionsQuery,
  PluginVersionsResponse,
  RuleDriftQuery,
  RuleDriftResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { connectionState } from "../dash/dash.ts";
import { readPluginVersions } from "../factory-health/plugins.ts";
import { readCachedRuleFiles, ruleDriftOf } from "../factory-health/rule-drift.ts";
import { compareRunRows, readFactoryRuns } from "../factory-health/runs.ts";
import { createTemplateReader } from "../factory-health/templates.ts";
import { paginate } from "../paging.ts";
import { workCompleteness } from "../sessions/work-items.ts";
import { readRepoList } from "../work/repo-list.ts";
import { resolveWorkScope } from "../work/scope.ts";
import { NO_TOKEN_STATE, readTokens, type TokenSource } from "../work/tokens.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface FactoryHealthOptions {
  claudeDir: string;
  /** The folder of the one `directory` Marketplace that Foreman may read. */
  marketplaceDir: string | undefined;
  /** The tokens file. A repo of an owner with no token returns no cached data. */
  tokenSource: TokenSource;
  db: Database;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

export const factoryHealthRoutes: FastifyPluginCallbackZod<FactoryHealthOptions> = (
  app,
  { claudeDir, marketplaceDir, tokenSource, db, now = () => new Date() },
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
    "/rule-drift",
    {
      config: { public: true },
      schema: {
        querystring: RuleDriftQuery,
        response: { 200: RuleDriftResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const list = await readRepoList(claudeDir);
      const entries = list.status === "ok" ? list.repos : [];
      const tokens = await readTokens(tokenSource);
      const scope = resolveWorkScope(entries, tokens, client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });

      const readable = new Set(scope.repos.map((entry) => entry.id));
      const named = scope.inScope.flatMap((entry) =>
        entry.owner === null || entry.name === null
          ? []
          : [{ id: entry.id, fullName: `${entry.owner}/${entry.name}` }],
      );
      const page = paginate(named, {
        limit,
        cursor,
        query: { client, repo },
        keyOf: (row) => [row.fullName, row.id],
        compare: (a, b) => {
          for (const [index, left] of a.entries()) {
            const right = b[index];
            if (right === undefined || left === right) continue;
            return String(left) < String(right) ? -1 : 1;
          }
          return 0;
        },
      });

      const completeness = await workCompleteness(db, scope.inScope, scope.repos);
      const ids = page.items.filter((row) => readable.has(row.id)).map((row) => row.id);
      const cacheRows = await db
        .select({
          id: schema.workRepos.id,
          forgeState: schema.workRepos.forgeState,
          trackerState: schema.workRepos.trackerState,
          lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
          defaultBranch: schema.workRepos.defaultBranch,
          fileBranch: schema.workRepos.fileBranch,
          repoState: schema.workRepos.repoState,
        })
        .from(schema.workRepos);
      const cacheById = new Map(cacheRows.map((row) => [row.id, row]));
      const files = await readCachedRuleFiles(db, ids);
      const reader = await createTemplateReader(claudeDir);

      const items = [];
      for (const row of page.items) {
        const cached = readable.has(row.id) ? cacheById.get(row.id) : undefined;
        items.push(
          await ruleDriftOf(
            {
              repoId: row.id,
              repo: row.fullName,
              cache: !readable.has(row.id)
                ? {
                    defaultBranch: null,
                    fileBranch: null,
                    repoState: null,
                    connection: NO_TOKEN_STATE,
                    dataAsOf: null,
                  }
                : cached === undefined
                  ? undefined
                  : {
                      defaultBranch: cached.defaultBranch,
                      fileBranch: cached.fileBranch,
                      repoState: cached.repoState,
                      connection: connectionState(cached),
                      dataAsOf: cached.lastGoodFetchAt,
                    },
              files: readable.has(row.id) ? files.get(row.id) : undefined,
            },
            reader,
          ),
        );
      }
      request.log.info(
        { repos: items.length, skippedTemplates: reader.skippedTemplates() },
        "rule drift read",
      );
      return {
        state: completeness.notConnected ? ("not_connected" as const) : ("ok" as const),
        items,
        nextCursor: page.nextCursor,
        complete: { incompleteRepos: completeness.incompleteRepos },
        skipped: { templates: reader.skippedTemplates() },
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
