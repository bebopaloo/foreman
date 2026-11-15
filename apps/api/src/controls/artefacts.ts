import { schema, type Database } from "@foreman/db";
import type { ControlsArtefactRow, ControlsRegisterRow } from "@foreman/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { CursorKey } from "../paging.ts";
import type { CachedFile, CachedFiles } from "./cache.ts";
import type { EventRepo } from "./escalations.ts";
import { compareTagsDescending } from "./releases.ts";
import { releaseRecordFieldsSchema } from "./release-records.ts";

type FileState = ControlsArtefactRow["riskMap"]["state"];

const FILE_STATES: readonly FileState[] = [
  "ok",
  "module_off",
  "missing_file",
  "missing_ref",
  "not_readable",
  "failed",
];

/** The state of a Forge file row as the API shows it. A missing row is `not_read`. */
export function asFileState(value: string | null | undefined): FileState {
  if (value === null || value === undefined) return "not_read";
  return FILE_STATES.find((state) => state === value) ?? "failed";
}

function base(file: CachedFile<unknown> | undefined) {
  if (file === undefined) {
    return { state: "not_read" as const, ref: null, sha7: null, fetchedAt: null, skipped: [] };
  }
  return {
    state: asFileState(file.state),
    ref: file.ref,
    sha7: file.sha?.slice(0, 7) ?? null,
    fetchedAt: file.fetchedAt.toISOString(),
    skipped: file.skipped,
  };
}

/** The Risk map, Control register, Threat model and Waiver register summary of each repo. */
export function buildArtefacts(
  repos: readonly EventRepo[],
  files: ReadonlyMap<string, CachedFiles>,
): ControlsArtefactRow[] {
  return [...repos]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((repo) => {
      const cached = files.get(repo.id);
      const risk = cached?.riskMap;
      const register = cached?.controlRegister;
      const threat = cached?.threatModel;
      const waivers = cached?.waiverRegister;
      const registerIds =
        register?.state === "ok" && register.fields !== null
          ? new Set(register.fields.controls.map((control) => control.id))
          : null;
      const compared = threat?.state === "ok" && registerIds !== null;
      return {
        repoId: repo.id,
        repo: repo.fullName,
        riskMap: {
          ...base(risk),
          summary:
            risk?.fields == null
              ? null
              : { ...risk.fields.tiers, boundaries: risk.fields.boundaries.length },
        },
        controlRegister: {
          ...base(register),
          summary: register?.fields == null ? null : { controls: register.fields.controls.length },
        },
        threatModel: {
          ...base(threat),
          summary:
            threat?.fields == null
              ? null
              : {
                  boundaries: threat.fields.boundaries.length,
                  threats: threat.fields.threats.length,
                  withoutControl: threat.fields.threats
                    .filter((item) => item.controls.length === 0)
                    .map((item) => item.id),
                  citedNotInRegister: compared
                    ? [
                        ...new Set(
                          threat.fields.threats
                            .flatMap((item) => item.controls)
                            .filter((id) => !registerIds.has(id)),
                        ),
                      ].sort()
                    : null,
                },
        },
        waiverRegister: {
          ...base(waivers),
          summary: waivers?.fields == null ? null : { waivers: waivers.fields.waivers.length },
        },
      };
    });
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const registerKey = (row: Pick<ControlsRegisterRow, "repoId" | "id">): CursorKey => [
  row.repoId,
  row.id,
];

/** The repo ID, then the Control ID. */
export const compareRegisterKeys = (a: CursorKey, b: CursorKey): number =>
  byText(String(a[0]), String(b[0])) || byText(String(a[1]), String(b[1]));

/**
 * The Controls of each cached Control register, with the status in the newest valid Release
 * record of the repo (by semantic version), or null when the Control is not in that record.
 */
export async function buildRegisterRows(
  db: Database,
  repos: readonly EventRepo[],
  files: ReadonlyMap<string, CachedFiles>,
): Promise<ControlsRegisterRow[]> {
  if (repos.length === 0) return [];
  const records = await db
    .select({
      repoId: schema.workReleaseRecords.repoId,
      tag: schema.workReleaseRecords.tag,
      fields: schema.workReleaseRecords.fields,
    })
    .from(schema.workReleaseRecords)
    .where(
      and(
        inArray(
          schema.workReleaseRecords.repoId,
          repos.map((repo) => repo.id),
        ),
        eq(schema.workReleaseRecords.state, "ok"),
      ),
    );
  const newest = new Map<string, { tag: string; statuses: Map<string, string> }>();
  for (const row of [...records].sort((a, b) => compareTagsDescending(a.tag, b.tag))) {
    if (newest.has(row.repoId)) continue;
    const parsed = releaseRecordFieldsSchema.safeParse(row.fields);
    if (!parsed.success) continue;
    newest.set(row.repoId, {
      tag: row.tag,
      statuses: new Map(
        (parsed.data.controls ?? []).map((control) => [control.id, control.status]),
      ),
    });
  }

  const rows: ControlsRegisterRow[] = [];
  for (const repo of repos) {
    const record = newest.get(repo.id);
    for (const control of files.get(repo.id)?.controlRegister?.fields?.controls ?? []) {
      const status = record?.statuses.get(control.id);
      rows.push({
        repoId: repo.id,
        repo: repo.fullName,
        id: control.id,
        title: control.title,
        owner: control.owner,
        sources: control.sources,
        modules: control.modules,
        manualChecks: control.manualChecks,
        status: record === undefined || status === undefined ? null : { tag: record.tag, status },
      });
    }
  }
  return rows.sort((a, b) => compareRegisterKeys(registerKey(a), registerKey(b)));
}
