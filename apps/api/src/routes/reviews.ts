import type { Database } from "@foreman/db";
import {
  ReviewsPullRequestsQuery,
  ReviewsPullRequestsResponse,
  ReviewsQuery,
  ReviewsResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginate } from "../paging.ts";
import {
  buildReviews,
  compareReviewRows,
  readReviewsData,
  reviewRowKey,
  reviewRows,
  type ReviewsData,
} from "../reviews/reviews.ts";
import { readRepoList } from "../work/repo-list.ts";
import { resolveWorkScope } from "../work/scope.ts";
import { readTokens, type TokenSource } from "../work/tokens.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface ReviewsOptions {
  db: Database;
  claudeDir: string;
  /** The tokens file. A repo of an owner with no token has no cache rows in scope. */
  tokenSource: TokenSource;
  /** The Factory identity logins of the config. */
  factoryLogins?: readonly string[];
  /** The "data as of" time of the Usage index, as an ISO time, or null before the first refresh. */
  usageDataAsOf?: () => Promise<string | null>;
  /** Tests pass a fixed clock. */
  now?: () => Date;
}

export const reviewsRoutes: FastifyPluginCallbackZod<ReviewsOptions> = (
  app,
  {
    db,
    claudeDir,
    tokenSource,
    factoryLogins = [],
    usageDataAsOf = () => Promise.resolve(null),
    now = () => new Date(),
  },
  done,
) => {
  async function load(client: string | undefined, repo: string | undefined, at: Date) {
    const list = await readRepoList(claudeDir);
    const entries = list.status === "ok" ? list.repos : [];
    const scope = resolveWorkScope(entries, await readTokens(tokenSource), client, repo);
    if (!scope.ok) return scope;
    const asOf = await usageDataAsOf();
    const data = await readReviewsData(
      claudeDir,
      at,
      db,
      factoryLogins,
      {
        inScope: scope.inScope,
        repoIds: scope.repos.map((scoped) => scoped.id),
        client,
        narrowed: client !== undefined || repo !== undefined,
      },
      asOf === null ? null : new Date(asOf),
    );
    return { ok: true as const, data };
  }

  function logSkipped(
    log: { warn: (object: object, message: string) => void },
    { dash }: ReviewsData,
  ): void {
    for (const [folder, files] of [
      ["runs", dash.nightLog.reports],
      ["controls", dash.controls.reports],
    ] as const) {
      for (const { file, lines } of files) {
        log.warn(
          { folder, file, skippedLines: lines },
          lines === 0 ? "reviews skipped a file" : "reviews skipped lines",
        );
      }
    }
  }

  // Public for the same reason as the Usage routes: Foreman binds to 127.0.0.1 and has no sign-in.
  app.get(
    "/reviews",
    {
      config: { public: true },
      schema: {
        querystring: ReviewsQuery,
        response: { 200: ReviewsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const at = now();
      const { client, mode } = request.query;
      const loaded = await load(client, undefined, at);
      if (!loaded.ok) {
        return reply.status(400).send({ error: loaded.error, requestId: request.id });
      }
      logSkipped(request.log, loaded.data);
      return buildReviews(loaded.data, mode, at);
    },
  );

  app.get(
    "/reviews/pull-requests",
    {
      config: { public: true },
      schema: {
        querystring: ReviewsPullRequestsQuery,
        response: { 200: ReviewsPullRequestsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const at = now();
      const { client, repo, tier, limit, cursor } = request.query;
      const loaded = await load(client, repo, at);
      if (!loaded.ok) {
        return reply.status(400).send({ error: loaded.error, requestId: request.id });
      }
      logSkipped(request.log, loaded.data);
      const rows = reviewRows(loaded.data, { repo, tier }, at);
      return paginate(rows, {
        limit,
        cursor,
        query: { client, repo, tier },
        keyOf: reviewRowKey,
        compare: compareReviewRows,
      });
    },
  );

  done();
};
