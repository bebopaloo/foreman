import type { Database } from "@foreman/db";
import {
  ControlsQuery,
  ControlsRegisterQuery,
  ControlsRegisterResponse,
  ControlsReleasesQuery,
  ControlsReleasesResponse,
  ControlsResponse,
  ControlsWaiversQuery,
  ControlsWaiversResponse,
  type ControlsModuleRow,
  type ControlsWaiverRow,
} from "@foreman/shared";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  buildArtefacts,
  buildRegisterRows,
  asFileState,
  compareRegisterKeys,
  registerKey,
} from "../controls/artefacts.ts";
import { readModuleFiles } from "../controls/cache.ts";
import {
  buildEscalations,
  countRepeated,
  ESCALATION_ROWS_SHOWN,
  type EventRepo,
} from "../controls/escalations.ts";
import { readControlModules } from "../controls/modules.ts";
import { pullKey, readPullLinks } from "../controls/pull-links.ts";
import { buildReleaseRows, compareReleaseKeys, releaseKey } from "../controls/releases.ts";
import { buildWaivers, compareWaiverKeys, waiverKey } from "../controls/waivers.ts";
import { readControlEvents } from "../dash/control-events.ts";
import { paginate } from "../paging.ts";
import { workCompleteness } from "../sessions/work-items.ts";
import { readRepoList, type RepoEntry } from "../work/repo-list.ts";
import { resolveWorkScope, type ScopedRepo, type WorkScope } from "../work/scope.ts";
import { readTokens, type TokenSource } from "../work/tokens.ts";

const RejectedResponse = z.object({ error: z.string(), requestId: z.string() }).strict();

export interface ControlsOptions {
  db: Database;
  claudeDir: string;
  /** The tokens file. A repo of an owner with no token returns no cached data. */
  tokenSource: TokenSource;
  /** Tests pass a fixed clock for the 30-day window of the Control events and the Waiver expiry. */
  now?: () => Date;
}

function fullNameOf(entry: RepoEntry): string | null {
  return entry.owner === null || entry.name === null ? null : `${entry.owner}/${entry.name}`;
}

export const controlsRoutes: FastifyPluginCallbackZod<ControlsOptions> = (
  app,
  { db, claudeDir, tokenSource, now = () => new Date() },
  done,
) => {
  async function scopeOf(client: string | undefined, repo: string | undefined) {
    const list = await readRepoList(claudeDir);
    const entries = list.status === "ok" ? list.repos : [];
    return resolveWorkScope(entries, await readTokens(tokenSource), client, repo);
  }

  /** The repos of the scope by ID, with their `owner/name`. Only repos with a forge name. */
  function named(scope: Extract<WorkScope, { ok: true }>): {
    all: EventRepo[];
    connected: (ScopedRepo & EventRepo)[];
  } {
    const byId = new Map(scope.inScope.map((entry) => [entry.id, entry]));
    const all = scope.inScope.flatMap((entry) => {
      const fullName = fullNameOf(entry);
      return fullName === null ? [] : [{ id: entry.id, fullName }];
    });
    const connected = scope.repos.flatMap((repo) => {
      const entry = byId.get(repo.id);
      const fullName = entry === undefined ? null : fullNameOf(entry);
      return fullName === null ? [] : [{ ...repo, fullName }];
    });
    return { all, connected };
  }

  async function readEvents(request: { log: { warn: (data: object, message: string) => void } }) {
    const controls = await readControlEvents(claudeDir, now());
    for (const { file, lines } of controls.reports) {
      request.log.warn(
        { folder: "controls", file, skippedLines: lines },
        lines === 0 ? "controls skipped a file" : "controls skipped lines",
      );
    }
    return controls;
  }

  app.get(
    "/controls",
    {
      config: { public: true },
      schema: {
        querystring: ControlsQuery,
        response: { 200: ControlsResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const scope = await scopeOf(request.query.client, undefined);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      const { all, connected } = named(scope);
      const controls = await readEvents(request);
      const completeness = await workCompleteness(db, scope.inScope, scope.repos);

      const escalations = buildEscalations(controls.events, all);
      const shown = escalations.slice(0, ESCALATION_ROWS_SHOWN);
      const links = await readPullLinks(
        db,
        scope.repos,
        shown.map((row) => ({ repoId: row.repoId, number: row.latestPull })),
      );

      const configs = new Map((await readControlModules(db)).map((row) => [row.repoId, row]));
      // A repo with no cache row shows in no section: it counts in `complete`.
      const cached = connected.filter((repo) => configs.has(repo.id));
      const files = await readModuleFiles(
        db,
        cached.map((repo) => repo.id),
      );
      const modules = cached
        .map((repo): ControlsModuleRow => {
          const row = configs.get(repo.id);
          const config = row?.config ?? null;
          return {
            repoId: repo.id,
            repo: repo.fullName,
            defaultBranch: row?.defaultBranch ?? null,
            fileBranch: row?.fileBranch ?? null,
            repoState: row?.repoState ?? null,
            configState: asFileState(row?.configState),
            controlsKey: config?.controls.state ?? null,
            profile: row?.profile ?? "none",
            modules: [...(row?.modules ?? [])],
            controlEvents: row?.controlEvents ?? false,
            mainBranch: config?.mainBranch ?? null,
            productionBranch: config?.releases?.productionBranch ?? null,
            switchedOver: config?.releases?.switchedOver ?? null,
          };
        })
        .sort((a, b) => (a.repoId < b.repoId ? -1 : a.repoId > b.repoId ? 1 : 0));
      const artefacts = buildArtefacts(cached, files);

      let entries = 0;
      for (const cached of files.values()) {
        for (const file of [
          cached.riskMap,
          cached.controlRegister,
          cached.waiverRegister,
          cached.threatModel,
        ]) {
          entries += file?.skipped.length ?? 0;
        }
      }

      return {
        state: completeness.notConnected ? ("not_connected" as const) : ("ok" as const),
        modules,
        escalations: {
          rows: shown.map(({ latestAt, latestPull, ...row }) => ({
            ...row,
            latestAt: latestAt.toISOString(),
            latestPull: {
              number: latestPull,
              link: links.get(pullKey(row.repoId, latestPull)) ?? null,
            },
          })),
          total: escalations.length,
          repeatedPaths: countRepeated(escalations),
        },
        artefacts,
        skipped: { controlEvents: controls.skippedLines, files: controls.skippedFiles, entries },
        complete: { incompleteRepos: completeness.incompleteRepos },
      };
    },
  );

  app.get(
    "/controls/waivers",
    {
      config: { public: true },
      schema: {
        querystring: ControlsWaiversQuery,
        response: { 200: ControlsWaiversResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      const { all, connected } = named(scope);
      const controls = await readEvents(request);
      const files = await readModuleFiles(
        db,
        connected.map((item) => item.id),
      );
      const fileBranches = new Map(
        (await readControlModules(db)).map((row) => [row.repoId, row.fileBranch]),
      );
      const rows = buildWaivers({
        events: controls.events,
        eventRepos: all,
        registerRepos: connected.map((item) => ({
          id: item.id,
          fullName: item.fullName,
          fileBranch: fileBranches.get(item.id) ?? null,
        })),
        files,
        today: now().toISOString().slice(0, 10),
      });
      const page = paginate(rows, {
        limit,
        cursor,
        query: { client, repo },
        keyOf: waiverKey,
        compare: compareWaiverKeys,
      });
      const links = await readPullLinks(
        db,
        scope.repos,
        page.items.flatMap((row) =>
          row.newestPull === null ? [] : [{ repoId: row.repoId, number: row.newestPull }],
        ),
      );
      return {
        items: page.items.map(({ newestPull, ...row }): ControlsWaiverRow => ({
          ...row,
          newestPull:
            newestPull === null
              ? null
              : { number: newestPull, link: links.get(pullKey(row.repoId, newestPull)) ?? null },
        })),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.get(
    "/controls/releases",
    {
      config: { public: true },
      schema: {
        querystring: ControlsReleasesQuery,
        response: { 200: ControlsReleasesResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      const rows = await buildReleaseRows(db, named(scope).connected);
      rows.sort((a, b) => compareReleaseKeys(releaseKey(a), releaseKey(b)));
      return paginate(rows, {
        limit,
        cursor,
        query: { client, repo },
        keyOf: releaseKey,
        compare: compareReleaseKeys,
      });
    },
  );

  app.get(
    "/controls/register",
    {
      config: { public: true },
      schema: {
        querystring: ControlsRegisterQuery,
        response: { 200: ControlsRegisterResponse, 400: RejectedResponse },
      },
    },
    async (request, reply) => {
      const { client, repo, limit, cursor } = request.query;
      const scope = await scopeOf(client, repo);
      if (!scope.ok) return reply.status(400).send({ error: scope.error, requestId: request.id });
      const { connected } = named(scope);
      const files = await readModuleFiles(
        db,
        connected.map((item) => item.id),
      );
      const rows = await buildRegisterRows(db, connected, files);
      return paginate(rows, {
        limit,
        cursor,
        query: { client, repo },
        keyOf: registerKey,
        compare: compareRegisterKeys,
      });
    },
  );

  done();
};
