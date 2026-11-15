import { schema, type Database } from "@foreman/db";
import type { ControlsReleaseRecord, ControlsReleaseRow } from "@foreman/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { CursorKey } from "../paging.ts";
import { linkFor } from "../work/lists.ts";
import type { ScopedRepo } from "../work/scope.ts";
import { readControlModules } from "./modules.ts";
import { releaseRecordFieldsSchema, type ReleaseRecordFields } from "./release-records.ts";

const RELEASE_REVIEW_CONTEXT = "factory/release-review";
const PRODUCTION_BRANCH = "production";
const RELEASE_MODULE = "release_record";
const VERSION = /^v([0-9]+)\.([0-9]+)\.([0-9]+)/;
const TAG_VERSION = /(?:^|-)v([0-9]+)\.([0-9]+)\.([0-9]+)$/;

export interface ReleaseRepo extends ScopedRepo {
  fullName: string;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The numbers of a version, or `-1` for each when the name is not `vX.Y.Z`. */
function versionOf(name: string, pattern: RegExp = VERSION): [number, number, number] {
  const match = pattern.exec(name);
  if (match === null) return [-1, -1, -1];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function releaseKey(row: Pick<ControlsReleaseRow, "repoId" | "name">): CursorKey {
  const [major, minor, patch] = versionOf(row.name);
  return [row.repoId, major, minor, patch, row.name];
}

/** The repo ID, then the semantic version from high to low, then the name from high to low. */
export function compareReleaseKeys(a: CursorKey, b: CursorKey): number {
  return (
    byText(String(a[0]), String(b[0])) ||
    Number(b[1]) - Number(a[1]) ||
    Number(b[2]) - Number(a[2]) ||
    Number(b[3]) - Number(a[3]) ||
    byText(String(b[4]), String(a[4]))
  );
}

/** Compares two Release record tags (`vX.Y.Z` or `<plugin>-vX.Y.Z`), the higher version first. */
export function compareTagsDescending(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = versionOf(a, TAG_VERSION);
  const [bMajor, bMinor, bPatch] = versionOf(b, TAG_VERSION);
  return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch || byText(b, a);
}

function recordView(
  fields: ReleaseRecordFields,
  fetchedAt: Date,
): Extract<ControlsReleaseRecord, { kind: "ok" }> {
  const approval = fields.approval;
  const notProven = new Set(["failing", "untested"]);
  return {
    kind: "ok",
    tier: fields.tier,
    approval:
      approval === null
        ? { kind: "not_recorded" }
        : approval.approvedBy !== null
          ? { kind: "approved", by: approval.approvedBy, time: approval.time }
          : approval.required
            ? { kind: "missing" }
            : { kind: "not_needed", threshold: approval.threshold },
    gaps: {
      total: fields.gaps.total,
      controlsNotProven: (fields.controls ?? [])
        .filter((control) => notProven.has(control.status))
        .map((control) => control.id),
      directCommits: fields.gaps.directCommits,
      approvalMissing: fields.gaps.approvalMissing > 0,
      pullRequestsWithoutReview: fields.gaps.pullRequestsWithoutReview,
      other: fields.gaps.other,
    },
    fetchedAt: fetchedAt.toISOString(),
  };
}

const RECORD_REASONS: Record<string, Extract<ControlsReleaseRecord, { kind: "none" }>["reason"]> = {
  no_record: "no_record",
  more_than_one_record: "more_than_one_record",
  not_readable: "not_readable",
  missing_tag: "missing",
  missing_asset: "missing",
  failed: "failed",
};

/** The tracker Releases of the repos, with their forge release, record and release review. */
export async function buildReleaseRows(
  db: Database,
  repos: readonly ReleaseRepo[],
): Promise<ControlsReleaseRow[]> {
  if (repos.length === 0) return [];
  const ids = repos.map((repo) => repo.id);
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const releases = await db
    .select()
    .from(schema.workReleases)
    .where(inArray(schema.workReleases.repoId, ids));
  const forgeRows = await db
    .select()
    .from(schema.workForgeReleases)
    .where(inArray(schema.workForgeReleases.repoId, ids));
  const recordRows = await db
    .select()
    .from(schema.workReleaseRecords)
    .where(inArray(schema.workReleaseRecords.repoId, ids));
  const pulls = await db
    .select({
      repoId: schema.workPullRequests.repoId,
      number: schema.workPullRequests.number,
      headBranch: schema.workPullRequests.headBranch,
      headSha: schema.workPullRequests.headSha,
      checks: schema.workPullRequests.checks,
      link: schema.workPullRequests.link,
    })
    .from(schema.workPullRequests)
    .where(
      and(
        inArray(schema.workPullRequests.repoId, ids),
        eq(schema.workPullRequests.state, "open"),
        eq(schema.workPullRequests.baseBranch, PRODUCTION_BRANCH),
      ),
    );
  const statuses = await db
    .select({
      repoId: schema.workCommitStatuses.repoId,
      pullRequestNumber: schema.workCommitStatuses.pullRequestNumber,
      sha: schema.workCommitStatuses.sha,
      state: schema.workCommitStatuses.state,
    })
    .from(schema.workCommitStatuses)
    .where(
      and(
        inArray(schema.workCommitStatuses.repoId, ids),
        eq(schema.workCommitStatuses.context, RELEASE_REVIEW_CONTEXT),
      ),
    );
  const modules = new Map((await readControlModules(db)).map((row) => [row.repoId, row.modules]));

  const forgeByKey = new Map(forgeRows.map((row) => [JSON.stringify([row.repoId, row.tag]), row]));
  const recordByKey = new Map(
    recordRows.map((row) => [JSON.stringify([row.repoId, row.tag]), row]),
  );
  const statusByKey = new Map(
    statuses.map((row) => [JSON.stringify([row.repoId, row.pullRequestNumber]), row]),
  );

  return releases.flatMap((release): ControlsReleaseRow[] => {
    const repo = byId.get(release.repoId);
    if (repo === undefined) return [];
    const key = JSON.stringify([release.repoId, release.name]);
    const forge = forgeByKey.get(key);
    const base = {
      repoId: release.repoId,
      repo: repo.fullName,
      name: release.name,
      state: release.state,
      issueCount: release.issueNumbers.length,
      link: linkFor(release.link, repo),
    };

    if (release.state === "open") {
      const [major, minor] = versionOf(release.name);
      const branch = `release/${major.toString()}.${minor.toString()}`;
      const pull = pulls
        .filter((row) => row.repoId === release.repoId && row.headBranch === branch && major >= 0)
        .sort((a, b) => b.number - a.number)[0];
      const status =
        pull === undefined
          ? undefined
          : statusByKey.get(JSON.stringify([pull.repoId, pull.number]));
      return [
        {
          ...base,
          forgeReleaseLink: null,
          releasePull:
            pull === undefined
              ? null
              : {
                  number: pull.number,
                  link: linkFor(pull.link, repo),
                  checks: pull.checks,
                  review: status?.sha === pull.headSha ? status.state : null,
                },
          record: { kind: "none", reason: "before_release" },
        },
      ];
    }

    const noForgeRelease = forge === undefined || forge.noForgeRelease;
    const stored = recordByKey.get(key);
    const parsed = releaseRecordFieldsSchema.safeParse(stored?.fields);
    let record: ControlsReleaseRecord;
    if (stored?.state === "ok" && parsed.success) {
      record = recordView(parsed.data, stored.fetchedAt);
    } else if (!(modules.get(release.repoId) ?? []).includes(RELEASE_MODULE)) {
      record = { kind: "none", reason: "module_off" };
    } else if (noForgeRelease) {
      record = { kind: "none", reason: "no_forge_release" };
    } else if (stored === undefined) {
      record = { kind: "none", reason: "not_fetched" };
    } else {
      record = { kind: "none", reason: RECORD_REASONS[stored.state] ?? "not_readable" };
    }
    return [
      {
        ...base,
        forgeReleaseLink:
          forge === undefined || forge.noForgeRelease ? null : linkFor(forge.link, repo),
        releasePull: null,
        record,
      },
    ];
  });
}
