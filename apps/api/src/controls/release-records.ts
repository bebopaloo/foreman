import { z } from "zod";

const NOT_PROVEN = new Set(["failing", "untested"]);
const SHORT = 200;

const text = z.string().max(SHORT);

const recordSchema = z
  .object({
    release: z.object({
      name: text,
      pull_request: z.number().int().nonnegative(),
      tier: text.nullable(),
      baseline: text.optional(),
    }),
    pull_requests: z.array(
      z.object({
        number: z.number().int().nonnegative(),
        issue: z.number().int().nonnegative().nullish(),
        issue_type: text.nullish(),
        tier: text.nullish(),
        review_record: z.string().nullish(),
      }),
    ),
    direct_commits: z.array(z.unknown()),
    release_approval: z
      .object({
        required: z.boolean(),
        approved_by: text.nullable(),
        time: text.nullable(),
        threshold: text.nullable(),
      })
      .nullable(),
    controls: z
      .object({
        summary: z.record(z.string(), z.number().int().nonnegative()),
        controls: z.array(z.object({ id: text, status: text })),
      })
      .nullable(),
    waivers: z.array(
      z.object({
        id: text,
        expires: text,
        covers: z.object({ kind: text }),
      }),
    ),
    sbom_digest: text.nullable(),
    control_modules: z.array(text).nullable(),
    gaps: z.array(z.unknown()),
  })
  .strict();

/** The fields of a Release record that Foreman keeps. No review record, title, subject or gap text. */
export const releaseRecordFieldsSchema = z
  .object({
    tier: z.string().nullable(),
    pullRequest: z.number().int(),
    baseline: z.string().nullable(),
    pullRequests: z.array(
      z
        .object({
          number: z.number().int(),
          issue: z.number().int().nullable(),
          issueType: z.string().nullable(),
          tier: z.string().nullable(),
          hasReviewRecord: z.boolean(),
        })
        .strict(),
    ),
    directCommits: z.number().int(),
    approval: z
      .object({
        required: z.boolean(),
        approvedBy: z.string().nullable(),
        time: z.string().nullable(),
        threshold: z.string().nullable(),
      })
      .strict()
      .nullable(),
    controlCounts: z.record(z.string(), z.number().int()).nullable(),
    controls: z.array(z.object({ id: z.string(), status: z.string() }).strict()).nullable(),
    waivers: z.array(
      z.object({ id: z.string(), expires: z.string(), coversKind: z.string() }).strict(),
    ),
    sbomDigest: z.string().nullable(),
    modules: z.array(z.string()).nullable(),
    gaps: z
      .object({
        total: z.number().int(),
        controlsNotProven: z.number().int(),
        directCommits: z.number().int(),
        approvalMissing: z.number().int(),
        pullRequestsWithoutReview: z.number().int(),
        other: z.number().int(),
      })
      .strict(),
  })
  .strict();

export type ReleaseRecordFields = z.infer<typeof releaseRecordFieldsSchema>;

export type ReleaseRecordResult = { ok: true; fields: ReleaseRecordFields } | { ok: false };

/**
 * Parses the JSON text of a Release record and keeps only the fields that Foreman needs.
 * The gaps are counted from the structured fields, and the rest of the count is "other".
 * A text that is not valid JSON or does not match the record schema gives `{ ok: false }`.
 */
export function parseReleaseRecord(content: string, tag: string): ReleaseRecordResult {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  const parsed = recordSchema.safeParse(json);
  if (!parsed.success || parsed.data.release.name !== tag) return { ok: false };
  const record = parsed.data;

  const controlsNotProven =
    record.controls?.controls.filter((control) => NOT_PROVEN.has(control.status)).length ?? 0;
  const directCommits = record.direct_commits.length;
  const approvalMissing =
    record.release_approval?.required === true && record.release_approval.approved_by === null
      ? 1
      : 0;
  const pullRequestsWithoutReview = record.pull_requests.filter(
    (pull) => (pull.review_record ?? "").trim() === "",
  ).length;
  const total = record.gaps.length;
  const known = controlsNotProven + directCommits + approvalMissing + pullRequestsWithoutReview;

  return {
    ok: true,
    fields: {
      tier: record.release.tier,
      pullRequest: record.release.pull_request,
      baseline: record.release.baseline ?? null,
      pullRequests: record.pull_requests.map((pull) => ({
        number: pull.number,
        issue: pull.issue ?? null,
        issueType: pull.issue_type ?? null,
        tier: pull.tier ?? null,
        hasReviewRecord: (pull.review_record ?? "").trim() !== "",
      })),
      directCommits,
      approval:
        record.release_approval === null
          ? null
          : {
              required: record.release_approval.required,
              approvedBy: record.release_approval.approved_by,
              time: record.release_approval.time,
              threshold: record.release_approval.threshold,
            },
      controlCounts: record.controls?.summary ?? null,
      controls: record.controls?.controls ?? null,
      waivers: record.waivers.map((waiver) => ({
        id: waiver.id,
        expires: waiver.expires,
        coversKind: waiver.covers.kind,
      })),
      sbomDigest: record.sbom_digest,
      modules: record.control_modules,
      gaps: {
        total,
        controlsNotProven,
        directCommits,
        approvalMissing,
        pullRequestsWithoutReview,
        other: Math.max(0, total - known),
      },
    },
  };
}

/** The states of one Release record row. */
export const RECORD_STATES = [
  "ok",
  "no_record",
  "more_than_one_record",
  "missing_tag",
  "missing_asset",
  "not_readable",
  "failed",
] as const;

export type RecordState = (typeof RECORD_STATES)[number];

const ASSET_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,250}\.json$/;

export type RecordPlan =
  | { kind: "no_call"; state: "no_record" | "more_than_one_record" | "not_readable" }
  | { kind: "read"; name: string };

/** Chooses the Release record asset from the asset names of a forge release. */
export function planRecordRead(assetNames: readonly string[]): RecordPlan {
  const names = assetNames.filter((name) => name.endsWith(".json"));
  const [only] = names;
  if (only === undefined) return { kind: "no_call", state: "no_record" };
  if (names.length > 1) return { kind: "no_call", state: "more_than_one_record" };
  if (!ASSET_NAME_PATTERN.test(only)) return { kind: "no_call", state: "not_readable" };
  return { kind: "read", name: only };
}
