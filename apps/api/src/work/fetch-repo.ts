import { schema, type Database } from "@foreman/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { resolveAdapter, type AdapterRole, type ResolvedAdapter } from "./adapters.ts";
import { planRecordRead, parseReleaseRecord } from "../controls/release-records.ts";
import { contractSchemas, prReviewSchema, RELEASE_TAG_PATTERN } from "./contract.ts";
import type { RepoEntry } from "./repo-list.ts";
import {
  runAdapterCommand,
  type AdapterResult,
  type ErrorClass,
  type RunnerOptions,
} from "./runner.ts";
import { resolveToken, type TokenStore } from "./tokens.ts";

const WRITE_CHUNK = 500;

const MACHINE_GATE_CONTEXT = "factory/machine-gate";
const RELEASE_REVIEW_CONTEXT = "factory/release-review";
const RELEASE_BRANCH_PATTERN = /^release\/[0-9]+\.[0-9]+$/;
const RELEASE_BASE_BRANCH = "production";
const LINKED_ISSUE_PATTERN = /^([0-9]{1,9})-/;

export const OK_STATE = "ok";
export const PARTIAL_STATE = "partial";
export const NOT_CONFIGURED_STATE = "not configured";

export interface RoleOutcome {
  state: string;
  errorClass: string | null;
  /** True when the role did its work with no error. */
  clean: boolean;
}

export interface RepoOutcome {
  forge: RoleOutcome;
  tracker: RoleOutcome;
  calls: number;
}

export interface FetchContext {
  db: Database;
  claudeDir: string;
  tokens: TokenStore;
  runner: RunnerOptions;
  startedAt: Date;
  full: boolean;
}

interface Role {
  adapter: ResolvedAdapter;
  token: string;
}

type RoleSetup = { ok: true; role: Role } | { ok: false; outcome: RoleOutcome };

type Called<T> = { ok: true; data: T } | { ok: false; errorClass: ErrorClass; state: string };

/** Keeps a `url` only when it is `https`, on the repo's host, with no credentials and no port. */
export function safeLink(url: string, host: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const clean =
    parsed.protocol === "https:" &&
    parsed.hostname.toLowerCase() === host.toLowerCase() &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "";
  return clean ? parsed.href : null;
}

/** The issue number that a branch name starts with, as in `84-commit-status-cache`. */
function linkedIssueOf(headBranch: string): number | null {
  const match = LINKED_ISSUE_PATTERN.exec(headBranch);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function sameLabels(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((label, index) => label === right[index]);
}

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += WRITE_CHUNK) {
    result.push(items.slice(index, index + WRITE_CHUNK));
  }
  return result;
}

function failedOutcome(result: { errorClass: ErrorClass; state: string }): RoleOutcome {
  return { state: result.state, errorClass: result.errorClass, clean: false };
}

async function setupRole(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string },
  role: AdapterRole,
): Promise<RoleSetup> {
  const plugin = role === "forge" ? repo.forge : repo.tracker;
  if (plugin === null) {
    return { ok: false, outcome: { state: NOT_CONFIGURED_STATE, errorClass: null, clean: true } };
  }
  const resolved = await resolveAdapter(ctx.claudeDir, plugin, role);
  if (!resolved.ok) {
    return { ok: false, outcome: { state: resolved.state, errorClass: null, clean: false } };
  }
  const token = resolveToken(ctx.tokens, repo.host, repo.owner, resolved.adapter);
  if (!token.ok) {
    return { ok: false, outcome: { state: token.state, errorClass: null, clean: false } };
  }
  return { ok: true, role: { adapter: resolved.adapter, token: token.token } };
}

class Caller {
  calls = 0;
  readonly #ctx: FetchContext;
  readonly #role: Role;
  readonly #repo: RepoEntry & { owner: string; name: string };

  constructor(ctx: FetchContext, role: Role, repo: RepoEntry & { owner: string; name: string }) {
    this.#ctx = ctx;
    this.#role = role;
    this.#repo = repo;
  }

  /** Runs one command. The contract schema types the data that the runner already validated. */
  async run<T>(command: string[], schema: z.ZodType<T>): Promise<Called<T>> {
    this.calls += 1;
    let result: AdapterResult;
    try {
      result = await runAdapterCommand(
        {
          adapter: this.#role.adapter,
          host: this.#repo.host,
          repo: `${this.#repo.owner}/${this.#repo.name}`,
          token: this.#role.token,
          command,
        },
        this.#ctx.runner,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "CommandRefusedError") throw error;
      return { ok: false, errorClass: "other", state: "adapter error" };
    }
    if (!result.ok) return result;
    const parsed = schema.safeParse(result.data);
    if (!parsed.success)
      return { ok: false, errorClass: "invalid_output", state: "invalid adapter output" };
    return { ok: true, data: parsed.data };
  }
}

type TrackerRelease = z.infer<typeof contractSchemas.releaseList>[number];

interface TrackerResult {
  outcome: RoleOutcome;
  calls: number;
  releases: TrackerRelease[];
}

async function fetchTracker(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string; name: string },
  setup: RoleSetup,
): Promise<TrackerResult> {
  if (!setup.ok) return { outcome: setup.outcome, calls: 0, releases: [] };
  const caller = new Caller(ctx, setup.role, repo);
  const listedAll = await caller.run(
    ["issue", "list", "--state", "all"],
    contractSchemas.issueList,
  );
  const listedOpen = await caller.run(
    ["issue", "list", "--state", "open"],
    contractSchemas.issueList,
  );
  const releaseList = await caller.run(
    ["release", "list", "--state", "all"],
    contractSchemas.releaseList,
  );
  for (const result of [listedAll, listedOpen, releaseList]) {
    if (!result.ok) return { outcome: failedOutcome(result), calls: caller.calls, releases: [] };
  }
  if (!listedAll.ok || !listedOpen.ok || !releaseList.ok) {
    throw new Error("unreachable: a failed list returned above");
  }

  const issues = new Map(listedAll.data.map((issue) => [issue.number, issue]));
  for (const issue of listedOpen.data) issues.set(issue.number, issue);

  const cachedRows = await ctx.db
    .select()
    .from(schema.workIssues)
    .where(eq(schema.workIssues.repoId, repo.id));
  const cached = new Map(cachedRows.map((row) => [row.number, row]));

  const rows: (typeof schema.workIssues.$inferInsert)[] = [];
  let firstError: string | null = null;
  for (const issue of issues.values()) {
    const before = cached.get(issue.number);
    const needsDetails =
      ctx.full ||
      issue.state === "open" ||
      before === undefined ||
      before.detailsFetchedAt === null ||
      before.state !== issue.state ||
      before.issueState !== issue.issue_state ||
      !sameLabels(before.labels, issue.labels);

    let parent = before?.parent ?? null;
    let children = before?.children ?? [];
    let blockedBy = before?.blockedBy ?? [];
    let detailsFetchedAt = before?.detailsFetchedAt ?? null;
    let detailsErrorClass = before?.detailsErrorClass ?? null;
    if (needsDetails) {
      const relations = await caller.run(
        ["issue", "relations", String(issue.number)],
        contractSchemas.issueRelations,
      );
      if (relations.ok) {
        parent = relations.data.parent;
        children = relations.data.children;
        blockedBy = relations.data.blocked_by;
        detailsFetchedAt = ctx.startedAt;
        detailsErrorClass = null;
      } else {
        detailsErrorClass = relations.errorClass;
        firstError ??= relations.errorClass;
      }
    }
    rows.push({
      repoId: repo.id,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      issueState: issue.issue_state,
      priority: issue.priority,
      labels: issue.labels,
      author: issue.author,
      link: safeLink(issue.url, repo.host),
      parent,
      children,
      blockedBy,
      lastListedAt: ctx.startedAt,
      detailsFetchedAt,
      detailsErrorClass,
    });
  }

  const releaseRows = releaseList.data.map((release) => ({
    repoId: repo.id,
    name: release.name,
    state: release.state,
    link: safeLink(release.url, repo.host),
    issueNumbers: release.issues,
  }));

  await ctx.db.transaction(async (tx) => {
    for (const part of chunks(rows)) {
      await tx
        .insert(schema.workIssues)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.workIssues.repoId, schema.workIssues.number],
          set: issueSet,
        });
    }
    for (const part of chunks(releaseRows)) {
      await tx
        .insert(schema.workReleases)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.workReleases.repoId, schema.workReleases.name],
          set: releaseSet,
        });
    }
  });

  const outcome: RoleOutcome =
    firstError === null
      ? { state: OK_STATE, errorClass: null, clean: true }
      : { state: PARTIAL_STATE, errorClass: firstError, clean: false };
  return { outcome, calls: caller.calls, releases: releaseList.data };
}

async function fetchForge(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string; name: string },
  setup: RoleSetup,
  releases: readonly TrackerRelease[],
): Promise<{ outcome: RoleOutcome; calls: number }> {
  if (!setup.ok) return { outcome: setup.outcome, calls: 0 };
  const caller = new Caller(ctx, setup.role, repo);
  const listedAll = await caller.run(["pr", "list", "--state", "all"], contractSchemas.prList);
  const listedOpen = await caller.run(["pr", "list", "--state", "open"], contractSchemas.prList);
  if (!listedAll.ok) return { outcome: failedOutcome(listedAll), calls: caller.calls };
  if (!listedOpen.ok) return { outcome: failedOutcome(listedOpen), calls: caller.calls };

  const pulls = new Map(listedAll.data.map((pull) => [pull.number, pull]));
  for (const pull of listedOpen.data) pulls.set(pull.number, pull);

  const cachedRows = await ctx.db
    .select()
    .from(schema.workPullRequests)
    .where(eq(schema.workPullRequests.repoId, repo.id));
  const cached = new Map(cachedRows.map((row) => [row.number, row]));
  const cachedStatusRows = await ctx.db
    .select({
      pullRequestNumber: schema.workCommitStatuses.pullRequestNumber,
      context: schema.workCommitStatuses.context,
      sha: schema.workCommitStatuses.sha,
    })
    .from(schema.workCommitStatuses)
    .where(eq(schema.workCommitStatuses.repoId, repo.id));
  const cachedStatusSha = new Map(
    cachedStatusRows.map((row) => [`${String(row.pullRequestNumber)} ${row.context}`, row.sha]),
  );

  const rows: (typeof schema.workPullRequests.$inferInsert)[] = [];
  const statusRows: (typeof schema.workCommitStatuses.$inferInsert)[] = [];
  const reviewRows: (typeof schema.workReviews.$inferInsert)[] = [];
  const replacedReviews: number[] = [];
  let firstError: string | null = null;
  let skippedReviews = 0;
  for (const pull of pulls.values()) {
    const before = cached.get(pull.number);
    const needsDetails =
      ctx.full ||
      pull.state === "open" ||
      before === undefined ||
      before.detailsFetchedAt === null ||
      before.state !== pull.state ||
      before.detailsErrorClass !== null ||
      !sameLabels(before.labels, pull.labels);

    let detailsFetchedAt = before?.detailsFetchedAt ?? null;
    let detailsErrorClass = before?.detailsErrorClass ?? null;
    if (needsDetails) {
      const reviews = await caller.run(
        ["pr", "reviews", String(pull.number)],
        contractSchemas.prReviews,
      );
      if (reviews.ok) {
        replacedReviews.push(pull.number);
        reviews.data.forEach((raw, position) => {
          const parsed = prReviewSchema.safeParse(raw);
          const time = parsed.success ? new Date(parsed.data.time) : null;
          if (!parsed.success || time === null || Number.isNaN(time.getTime())) {
            skippedReviews += 1;
            return;
          }
          const review = parsed.data;
          reviewRows.push({
            repoId: repo.id,
            pullRequestNumber: pull.number,
            position,
            author: review.author,
            state: review.state,
            commit: review.commit,
            time,
          });
        });
        detailsFetchedAt = ctx.startedAt;
        detailsErrorClass = null;
      } else {
        detailsErrorClass = reviews.errorClass;
        firstError ??= reviews.errorClass;
      }
    }

    if (pull.head_sha !== undefined) {
      const headSha = pull.head_sha;
      const contexts: string[] = [];
      if (
        ctx.full ||
        pull.state === "open" ||
        cachedStatusSha.get(`${String(pull.number)} ${MACHINE_GATE_CONTEXT}`) !== headSha
      ) {
        contexts.push(MACHINE_GATE_CONTEXT);
      }
      if (
        pull.state === "open" &&
        RELEASE_BRANCH_PATTERN.test(pull.head) &&
        pull.base === RELEASE_BASE_BRANCH
      ) {
        contexts.push(RELEASE_REVIEW_CONTEXT);
      }
      for (const context of contexts) {
        const status = await caller.run(
          ["status", "get", headSha, context],
          contractSchemas.commitStatus,
        );
        if (status.ok) {
          statusRows.push({
            repoId: repo.id,
            pullRequestNumber: pull.number,
            context,
            sha: status.data.sha,
            state: status.data.state,
            fetchedAt: ctx.startedAt,
          });
        } else {
          detailsErrorClass = status.errorClass;
          firstError ??= status.errorClass;
        }
      }
    }
    rows.push({
      repoId: repo.id,
      number: pull.number,
      title: pull.title,
      state: pull.state,
      draft: pull.draft,
      headBranch: pull.head,
      baseBranch: pull.base,
      author: pull.author,
      checks: pull.checks,
      labels: pull.labels,
      link: safeLink(pull.url, repo.host),
      lastListedAt: ctx.startedAt,
      detailsFetchedAt,
      detailsErrorClass,
      headSha: pull.head_sha ?? null,
      linkedIssue: linkedIssueOf(pull.head),
    });
  }

  if (skippedReviews > 0) {
    const noun = skippedReviews === 1 ? "review" : "reviews";
    ctx.runner.log?.warn(`skipped ${String(skippedReviews)} ${noun} that fails the contract`);
  }

  const forgeRows = await fetchForgeReleases(ctx, repo, caller, releases);
  if (forgeRows.firstError !== null) firstError ??= forgeRows.firstError;
  const recordRows = await fetchReleaseRecords(ctx, repo, caller, forgeRows.rows);
  if (recordRows.firstError !== null) firstError ??= recordRows.firstError;

  await ctx.db.transaction(async (tx) => {
    for (const part of chunks(rows)) {
      await tx
        .insert(schema.workPullRequests)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.workPullRequests.repoId, schema.workPullRequests.number],
          set: pullRequestSet,
        });
    }
    for (const part of chunks(replacedReviews)) {
      await tx
        .delete(schema.workReviews)
        .where(
          and(
            eq(schema.workReviews.repoId, repo.id),
            inArray(schema.workReviews.pullRequestNumber, part),
          ),
        );
    }
    for (const part of chunks(reviewRows)) await tx.insert(schema.workReviews).values(part);
    for (const part of chunks(statusRows)) {
      await tx
        .insert(schema.workCommitStatuses)
        .values(part)
        .onConflictDoUpdate({
          target: [
            schema.workCommitStatuses.repoId,
            schema.workCommitStatuses.pullRequestNumber,
            schema.workCommitStatuses.context,
          ],
          set: commitStatusSet,
        });
    }
    for (const part of chunks(forgeRows.rows)) {
      await tx
        .insert(schema.workForgeReleases)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.workForgeReleases.repoId, schema.workForgeReleases.tag],
          set: forgeReleaseSet,
        });
    }
    for (const part of chunks(recordRows.rows)) {
      await tx
        .insert(schema.workReleaseRecords)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.workReleaseRecords.repoId, schema.workReleaseRecords.tag],
          set: releaseRecordSet,
        });
    }
  });

  const outcome: RoleOutcome =
    firstError === null
      ? { state: OK_STATE, errorClass: null, clean: true }
      : { state: PARTIAL_STATE, errorClass: firstError, clean: false };
  return { outcome, calls: caller.calls };
}

async function fetchForgeReleases(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string; name: string },
  caller: Caller,
  releases: readonly TrackerRelease[],
): Promise<{ rows: (typeof schema.workForgeReleases.$inferInsert)[]; firstError: string | null }> {
  const cachedRows = await ctx.db
    .select({
      tag: schema.workForgeReleases.tag,
      noForgeRelease: schema.workForgeReleases.noForgeRelease,
    })
    .from(schema.workForgeReleases)
    .where(eq(schema.workForgeReleases.repoId, repo.id));
  const cached = new Map(cachedRows.map((row) => [row.tag, row.noForgeRelease]));

  const rows: (typeof schema.workForgeReleases.$inferInsert)[] = [];
  let firstError: string | null = null;
  for (const release of releases) {
    if (release.state !== "released" || !RELEASE_TAG_PATTERN.test(release.name)) continue;
    const known = cached.get(release.name);
    if (known !== undefined && !(known && ctx.full)) continue;
    const view = await caller.run(["release", "view", release.name], contractSchemas.releaseView);
    if (view.ok) {
      rows.push({
        repoId: repo.id,
        tag: release.name,
        targetCommit: view.data.target,
        assetNames: view.data.assets,
        link: safeLink(view.data.url, repo.host),
        noForgeRelease: false,
      });
    } else if (view.errorClass === "not_found") {
      rows.push({
        repoId: repo.id,
        tag: release.name,
        targetCommit: null,
        assetNames: [],
        link: null,
        noForgeRelease: true,
      });
    } else {
      firstError ??= view.errorClass;
    }
  }
  return { rows, firstError };
}

/**
 * Reads the Release record of each cached forge release that has no final record yet.
 * A record that is `ok` or `not_readable` never changes, so a full fetch keeps it too.
 */
async function fetchReleaseRecords(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string; name: string },
  caller: Caller,
  freshReleases: readonly (typeof schema.workForgeReleases.$inferInsert)[],
): Promise<{ rows: (typeof schema.workReleaseRecords.$inferInsert)[]; firstError: string | null }> {
  const forgeCached = await ctx.db
    .select({
      tag: schema.workForgeReleases.tag,
      assetNames: schema.workForgeReleases.assetNames,
      noForgeRelease: schema.workForgeReleases.noForgeRelease,
    })
    .from(schema.workForgeReleases)
    .where(eq(schema.workForgeReleases.repoId, repo.id));
  const forgeReleases = new Map(forgeCached.map((row) => [row.tag, row]));
  for (const fresh of freshReleases) {
    forgeReleases.set(fresh.tag, {
      tag: fresh.tag,
      assetNames: fresh.assetNames ?? [],
      noForgeRelease: fresh.noForgeRelease ?? false,
    });
  }

  const recordCached = await ctx.db
    .select({ tag: schema.workReleaseRecords.tag, state: schema.workReleaseRecords.state })
    .from(schema.workReleaseRecords)
    .where(eq(schema.workReleaseRecords.repoId, repo.id));
  const final = new Set(
    recordCached
      .filter((row) => row.state === "ok" || row.state === "not_readable")
      .map((r) => r.tag),
  );

  const rows: (typeof schema.workReleaseRecords.$inferInsert)[] = [];
  let firstError: string | null = null;
  for (const forgeRelease of forgeReleases.values()) {
    if (forgeRelease.noForgeRelease || final.has(forgeRelease.tag)) continue;
    const base = { repoId: repo.id, tag: forgeRelease.tag, fetchedAt: ctx.startedAt };
    const plan = planRecordRead(forgeRelease.assetNames);
    if (plan.kind === "no_call") {
      rows.push({
        ...base,
        assetName: null,
        size: null,
        state: plan.state,
        errorClass: null,
        fields: null,
      });
      continue;
    }
    const asset = await caller.run(
      ["release", "asset", forgeRelease.tag, plan.name],
      contractSchemas.releaseAsset,
    );
    if (!asset.ok) {
      const state =
        asset.errorClass === "missing_tag" || asset.errorClass === "missing_asset"
          ? asset.errorClass
          : "failed";
      if (state === "failed") firstError ??= asset.errorClass;
      rows.push({
        ...base,
        assetName: plan.name,
        size: null,
        state,
        errorClass: asset.errorClass,
        fields: null,
      });
      continue;
    }
    const parsed = parseReleaseRecord(asset.data.content, forgeRelease.tag);
    rows.push({
      ...base,
      assetName: plan.name,
      size: asset.data.size,
      state: parsed.ok ? "ok" : "not_readable",
      errorClass: null,
      fields: parsed.ok ? parsed.fields : null,
    });
  }
  return { rows, firstError };
}

/** The value of a column in the row that an upsert tried to insert. */
function incoming(column: PgColumn) {
  return sql`excluded.${sql.identifier(column.name)}`;
}

const issueSet = {
  title: incoming(schema.workIssues.title),
  state: incoming(schema.workIssues.state),
  issueState: incoming(schema.workIssues.issueState),
  priority: incoming(schema.workIssues.priority),
  labels: incoming(schema.workIssues.labels),
  author: incoming(schema.workIssues.author),
  link: incoming(schema.workIssues.link),
  parent: incoming(schema.workIssues.parent),
  children: incoming(schema.workIssues.children),
  blockedBy: incoming(schema.workIssues.blockedBy),
  lastListedAt: incoming(schema.workIssues.lastListedAt),
  detailsFetchedAt: incoming(schema.workIssues.detailsFetchedAt),
  detailsErrorClass: incoming(schema.workIssues.detailsErrorClass),
};

const pullRequestSet = {
  title: incoming(schema.workPullRequests.title),
  state: incoming(schema.workPullRequests.state),
  draft: incoming(schema.workPullRequests.draft),
  headBranch: incoming(schema.workPullRequests.headBranch),
  baseBranch: incoming(schema.workPullRequests.baseBranch),
  author: incoming(schema.workPullRequests.author),
  checks: incoming(schema.workPullRequests.checks),
  labels: incoming(schema.workPullRequests.labels),
  link: incoming(schema.workPullRequests.link),
  lastListedAt: incoming(schema.workPullRequests.lastListedAt),
  detailsFetchedAt: incoming(schema.workPullRequests.detailsFetchedAt),
  detailsErrorClass: incoming(schema.workPullRequests.detailsErrorClass),
  headSha: incoming(schema.workPullRequests.headSha),
  linkedIssue: incoming(schema.workPullRequests.linkedIssue),
};

const commitStatusSet = {
  sha: incoming(schema.workCommitStatuses.sha),
  state: incoming(schema.workCommitStatuses.state),
  fetchedAt: incoming(schema.workCommitStatuses.fetchedAt),
};

const releaseSet = {
  state: incoming(schema.workReleases.state),
  link: incoming(schema.workReleases.link),
  issueNumbers: incoming(schema.workReleases.issueNumbers),
};

const forgeReleaseSet = {
  targetCommit: incoming(schema.workForgeReleases.targetCommit),
  assetNames: incoming(schema.workForgeReleases.assetNames),
  link: incoming(schema.workForgeReleases.link),
  noForgeRelease: incoming(schema.workForgeReleases.noForgeRelease),
};

/** Fetches one repo: the tracker role, then the forge role. A failed role keeps its cached rows. */
export async function fetchRepo(
  ctx: FetchContext,
  repo: RepoEntry & { owner: string; name: string },
): Promise<RepoOutcome> {
  const [trackerSetup, forgeSetup] = await Promise.all([
    setupRole(ctx, repo, "tracker"),
    setupRole(ctx, repo, "forge"),
  ]);
  const tracker = await fetchTracker(ctx, repo, trackerSetup);
  const forge = await fetchForge(ctx, repo, forgeSetup, tracker.releases);
  return { forge: forge.outcome, tracker: tracker.outcome, calls: tracker.calls + forge.calls };
}

const releaseRecordSet = {
  assetName: incoming(schema.workReleaseRecords.assetName),
  size: incoming(schema.workReleaseRecords.size),
  fetchedAt: incoming(schema.workReleaseRecords.fetchedAt),
  state: incoming(schema.workReleaseRecords.state),
  errorClass: incoming(schema.workReleaseRecords.errorClass),
  fields: incoming(schema.workReleaseRecords.fields),
};
