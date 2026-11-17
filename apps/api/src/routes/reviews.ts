import { schema, type Database } from "@foreman/db";
import {
  FindingsQuery,
  FindingsResponse,
  ReviewsPullRequestsQuery,
  ReviewsPullRequestsResponse,
  ReviewsQuery,
  ReviewsResponse,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { and, inArray } from "drizzle-orm";
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
import {
  buildFindings,
  compareFindingKeys,
  findingKey,
  readFindingsLedger,
} from "../reviews/findings-ledger.ts";
import { linkFor } from "../work/lists.ts";
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

  app.get(
    "/reviews/findings",
    {
      config: { public: true },
      schema: {
        querystring: FindingsQuery,
        response: { 200: FindingsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const at = now();
      const { client, limit, cursor, ...filter } = request.query;
      const list = await readRepoList(claudeDir);
      const entries = list.status === "ok" ? list.repos : [];
      const scope = resolveWorkScope(entries, await readTokens(tokenSource), client, undefined);
      if (!scope.ok) {
        return reply.status(400).send({ error: scope.error, requestId: request.id });
      }
      const ledger = await readFindingsLedger(claudeDir, at);
      for (const { file, lines } of ledger.reports) {
        request.log.warn(
          { folder: "findings", file, skippedLines: lines },
          lines === 0 ? "findings skipped a file" : "findings skipped lines",
        );
      }
      // With no client, the scope is all lines, the repos that are not in the repo list too.
      const repoNames =
        client === undefined
          ? null
          : new Set(
              scope.inScope.flatMap((entry) =>
                entry.owner === null || entry.name === null
                  ? []
                  : [`${entry.owner}/${entry.name}`.toLowerCase()],
              ),
            );
      const built = buildFindings(ledger.findings, { repoNames, filter });
      const page = paginate(built.rows, {
        limit,
        cursor,
        query: { client, ...filter },
        keyOf: findingKey,
        compare: compareFindingKeys,
      });

      const byId = new Map(scope.repos.map((repoScope) => [repoScope.id, repoScope]));
      const idOfName = new Map(
        scope.inScope.flatMap((entry) =>
          entry.owner === null || entry.name === null
            ? []
            : [[`${entry.owner}/${entry.name}`.toLowerCase(), entry.id] as const],
        ),
      );
      const numbers = [...new Set(page.items.map((row) => row.pr))];
      const pulls =
        byId.size === 0 || numbers.length === 0
          ? []
          : await db
              .select({
                repoId: schema.workPullRequests.repoId,
                number: schema.workPullRequests.number,
                link: schema.workPullRequests.link,
              })
              .from(schema.workPullRequests)
              .where(
                and(
                  inArray(schema.workPullRequests.repoId, [...byId.keys()]),
                  inArray(schema.workPullRequests.number, numbers),
                ),
              );
      const links = new Map(
        pulls.map((row) => [`${row.repoId}#${row.number.toString()}`, row.link]),
      );
      return {
        folder: ledger.folder,
        skippedLines: ledger.skippedLines,
        skippedFiles: ledger.skippedFiles,
        security: built.security,
        repos: built.repos,
        passes: built.passes,
        total: built.rows.length,
        items: page.items.map((row) => {
          const id = idOfName.get(row.repo.toLowerCase());
          const link = id === undefined ? null : (links.get(`${id}#${row.pr.toString()}`) ?? null);
          return { ...row, link: linkFor(link, id === undefined ? undefined : byId.get(id)) };
        }),
        nextCursor: page.nextCursor,
      };
    },
  );

  done();
};
