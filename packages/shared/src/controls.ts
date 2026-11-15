import { z } from "zod";
import { ClientName } from "./client.ts";
import { pageQueryShape, pageResponseSchema } from "./paging.ts";

const CONTROLS_PAGE = { defaultLimit: 100, maxLimit: 500 };
const RepoId = z.string().regex(/^[0-9a-f]{12}$/);

export const ControlsQuery = z.object({ client: ClientName.optional() }).strict();
export type ControlsQuery = z.infer<typeof ControlsQuery>;

const listShape = {
  client: ClientName.optional(),
  repo: RepoId.optional(),
  ...pageQueryShape(CONTROLS_PAGE),
};

export const ControlsWaiversQuery = z.object(listShape).strict();
export type ControlsWaiversQuery = z.infer<typeof ControlsWaiversQuery>;
export const ControlsReleasesQuery = z.object(listShape).strict();
export type ControlsReleasesQuery = z.infer<typeof ControlsReleasesQuery>;
export const ControlsRegisterQuery = z.object(listShape).strict();
export type ControlsRegisterQuery = z.infer<typeof ControlsRegisterQuery>;

/** The state of a Forge file row, or `not_read` when no step has read the file. */
export const FORGE_FILE_STATES = [
  "ok",
  "module_off",
  "missing_file",
  "missing_ref",
  "not_readable",
  "failed",
  "not_read",
] as const;
const ForgeFileState = z.enum(FORGE_FILE_STATES);

const Skipped = z.array(z.object({ position: z.number().int(), field: z.string() }).strict());

export const ControlsModuleRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    defaultBranch: z.string().nullable(),
    fileBranch: z.string().nullable(),
    /** The state of the last `repo` call: `ok`, `no_default_branch`, `failed` or null. */
    repoState: z.string().nullable(),
    configState: ForgeFileState,
    /** `ok`, `none` (no `controls` key) or `not_valid`. Null when the repo config is not read. */
    controlsKey: z.enum(["ok", "none", "not_valid"]).nullable(),
    profile: z.string(),
    modules: z.array(z.string()),
    controlEvents: z.boolean(),
    mainBranch: z.string().nullable(),
    productionBranch: z.string().nullable(),
    switchedOver: z.string().nullable(),
  })
  .strict();
export type ControlsModuleRow = z.infer<typeof ControlsModuleRow>;

const PullLink = z
  .object({ number: z.number().int(), link: z.string().nullable() })
  .strict()
  .nullable();

export const ControlsEscalationRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    path: z.string(),
    count: z.number().int(),
    pathTier: z.string().nullable(),
    tier: z.string().nullable(),
    latestAt: z.iso.datetime(),
    latestPull: PullLink,
    evidence: z.string().nullable(),
  })
  .strict();
export type ControlsEscalationRow = z.infer<typeof ControlsEscalationRow>;

const ArtefactState = ForgeFileState;

const artefactBase = {
  state: ArtefactState,
  /** The ref that the file was read at. */
  ref: z.string().nullable(),
  sha7: z.string().nullable(),
  fetchedAt: z.iso.datetime().nullable(),
  skipped: Skipped,
};

export const ControlsArtefactRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    riskMap: z
      .object({
        ...artefactBase,
        summary: z
          .object({
            authority: z.number().int(),
            sensitive: z.number().int(),
            general: z.number().int(),
            inert: z.number().int(),
            boundaries: z.number().int(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    controlRegister: z
      .object({
        ...artefactBase,
        summary: z.object({ controls: z.number().int() }).strict().nullable(),
      })
      .strict(),
    threatModel: z
      .object({
        ...artefactBase,
        summary: z
          .object({
            boundaries: z.number().int(),
            threats: z.number().int(),
            withoutControl: z.array(z.string()),
            /** Null unless the Threat model and the Control register are both `ok`. */
            citedNotInRegister: z.array(z.string()).nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    waiverRegister: z
      .object({
        ...artefactBase,
        summary: z.object({ waivers: z.number().int() }).strict().nullable(),
      })
      .strict(),
  })
  .strict();
export type ControlsArtefactRow = z.infer<typeof ControlsArtefactRow>;

export const ControlsResponse = z
  .object({
    state: z.enum(["ok", "not_connected"]),
    modules: z.array(ControlsModuleRow),
    escalations: z
      .object({
        rows: z.array(ControlsEscalationRow),
        total: z.number().int(),
        repeatedPaths: z.number().int(),
      })
      .strict(),
    artefacts: z.array(ControlsArtefactRow),
    skipped: z
      .object({
        controlEvents: z.number().int(),
        files: z.number().int(),
        entries: z.number().int(),
      })
      .strict(),
    /** The count of repos in scope with no cache rows, no token or a fetch error. */
    complete: z.object({ incompleteRepos: z.number().int() }).strict(),
  })
  .strict();
export type ControlsResponse = z.infer<typeof ControlsResponse>;

export const WaiverCoversShape = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("finding"),
      file: z.string(),
      category: z.string(),
      ref: z.string().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("check"), name: z.string() }).strict(),
  z.object({ kind: z.literal("control"), id: z.string() }).strict(),
]);

export const ControlsWaiverRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    id: z.string(),
    owner: z.string().nullable(),
    approvedBy: z.string().nullable(),
    created: z.string().nullable(),
    expires: z.string().nullable(),
    /**
     * `expired`: `expires` is today or earlier. `expiring`: 30 days or fewer away. `current`:
     * later. `not_in_register`: used in an event, and the register is read. `register_not_read`:
     * used in an event, and the register is not read.
     */
    expiry: z.enum(["expired", "expiring", "current", "not_in_register", "register_not_read"]),
    /** The days from today to `expires`, or null with no expiry date. */
    days: z.number().int().nullable(),
    /** The file branch that the register is read at, for `not_in_register`. */
    registerBranch: z.string().nullable(),
    covers: WaiverCoversShape.nullable(),
    uses: z.number().int(),
    newestPull: PullLink,
  })
  .strict();
export type ControlsWaiverRow = z.infer<typeof ControlsWaiverRow>;

export const ControlsWaiversResponse = pageResponseSchema(ControlsWaiverRow);
export type ControlsWaiversResponse = z.infer<typeof ControlsWaiversResponse>;

const Approval = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approved"), by: z.string(), time: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("not_needed"), threshold: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("not_recorded") }).strict(),
]);

const Gaps = z
  .object({
    total: z.number().int(),
    controlsNotProven: z.array(z.string()),
    directCommits: z.number().int(),
    approvalMissing: z.boolean(),
    pullRequestsWithoutReview: z.number().int(),
    other: z.number().int(),
  })
  .strict();

export const ControlsReleaseRecord = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ok"),
      tier: z.string().nullable(),
      approval: Approval,
      gaps: Gaps,
      fetchedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("none"),
      reason: z.enum([
        "before_release",
        "module_off",
        "no_forge_release",
        "no_record",
        "more_than_one_record",
        "not_readable",
        "missing",
        "failed",
        "not_fetched",
      ]),
    })
    .strict(),
]);
export type ControlsReleaseRecord = z.infer<typeof ControlsReleaseRecord>;

export const ControlsReleaseRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    name: z.string(),
    state: z.string(),
    issueCount: z.number().int(),
    link: z.string().nullable(),
    forgeReleaseLink: z.string().nullable(),
    /** The open pull request from `release/X.Y` into `production`. Null for a released Release. */
    releasePull: z
      .object({
        number: z.number().int(),
        link: z.string().nullable(),
        checks: z.string(),
        /** The state of `factory/release-review` on the head sha, or null. */
        review: z.string().nullable(),
      })
      .strict()
      .nullable(),
    record: ControlsReleaseRecord,
  })
  .strict();
export type ControlsReleaseRow = z.infer<typeof ControlsReleaseRow>;

export const ControlsReleasesResponse = pageResponseSchema(ControlsReleaseRow);
export type ControlsReleasesResponse = z.infer<typeof ControlsReleasesResponse>;

export const ControlsRegisterRow = z
  .object({
    repoId: RepoId,
    repo: z.string(),
    id: z.string(),
    title: z.string(),
    owner: z.string(),
    sources: z.number().int(),
    modules: z.number().int(),
    manualChecks: z.number().int(),
    /** The status in the newest valid Release record, or null when the Control is not in it. */
    status: z.object({ tag: z.string(), status: z.string() }).strict().nullable(),
  })
  .strict();
export type ControlsRegisterRow = z.infer<typeof ControlsRegisterRow>;

export const ControlsRegisterResponse = pageResponseSchema(ControlsRegisterRow);
export type ControlsRegisterResponse = z.infer<typeof ControlsRegisterResponse>;
