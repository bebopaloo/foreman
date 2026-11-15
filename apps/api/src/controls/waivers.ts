import type { ControlsWaiverRow } from "@foreman/shared";
import type { ControlEvent } from "../dash/control-events.ts";
import type { CursorKey } from "../paging.ts";
import type { CachedFiles } from "./cache.ts";
import { reposByFullName, type EventRepo } from "./escalations.ts";

/** A Waiver with 30 days or fewer to its expiry shows "expires in N days". */
export const EXPIRY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RegisterRepo extends EventRepo {
  fileBranch: string | null;
}

export interface WaiverRowData extends Omit<ControlsWaiverRow, "newestPull"> {
  newestPull: number | null;
}

interface Use {
  repo: EventRepo;
  id: string;
  uses: number;
  newestAt: number;
  newestPull: number;
}

/** The whole days from `today` to `date`, both `YYYY-MM-DD` in UTC. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** As `waivers.py` decides: `expires` today or earlier is expired. */
export function expiryOf(days: number): "expired" | "expiring" | "current" {
  if (days <= 0) return "expired";
  return days <= EXPIRY_WINDOW_DAYS ? "expiring" : "current";
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rows with a register entry first, by expiry date; then the rows with none, by repo ID and ID. */
export function waiverKey(row: Pick<WaiverRowData, "repoId" | "id" | "expires">): CursorKey {
  return [row.expires === null ? 1 : 0, row.expires ?? "", row.repoId, row.id];
}

export function compareWaiverKeys(a: CursorKey, b: CursorKey): number {
  return (
    Number(a[0]) - Number(b[0]) ||
    byText(String(a[1]), String(b[1])) ||
    byText(String(a[2]), String(b[2])) ||
    byText(String(a[3]), String(b[3]))
  );
}

/**
 * One row for each Waiver of the cached registers of `registerRepos`, and one row for each Waiver
 * ID of a `waiver_used` event that its repo's register does not have. `eventRepos` are the repos
 * that the events may name. `today` is the UTC date, `YYYY-MM-DD`.
 */
export function buildWaivers(input: {
  events: readonly ControlEvent[];
  eventRepos: readonly EventRepo[];
  registerRepos: readonly RegisterRepo[];
  files: ReadonlyMap<string, CachedFiles>;
  today: string;
}): WaiverRowData[] {
  const { events, eventRepos, registerRepos, files, today } = input;
  const known = reposByFullName(eventRepos);
  const uses = new Map<string, Use>();
  for (const event of events) {
    if (event.kind !== "waiver_used") continue;
    const repo = known.get(event.repo.toLowerCase());
    if (repo === undefined) continue;
    const key = JSON.stringify([repo.id, event.waiver]);
    const before = uses.get(key);
    const at = event.at.getTime();
    uses.set(key, {
      repo,
      id: event.waiver,
      uses: (before?.uses ?? 0) + 1,
      newestAt: before === undefined || at >= before.newestAt ? at : before.newestAt,
      newestPull: before === undefined || at >= before.newestAt ? event.pr : before.newestPull,
    });
  }

  const rows: WaiverRowData[] = [];
  const seen = new Set<string>();
  const registerById = new Map(registerRepos.map((repo) => [repo.id, repo]));
  for (const repo of registerRepos) {
    for (const waiver of files.get(repo.id)?.waiverRegister?.fields?.waivers ?? []) {
      const key = JSON.stringify([repo.id, waiver.id]);
      seen.add(key);
      const days = daysUntil(waiver.expires, today);
      const use = uses.get(key);
      rows.push({
        repoId: repo.id,
        repo: repo.fullName,
        id: waiver.id,
        owner: waiver.owner,
        approvedBy: waiver.approvedBy,
        created: waiver.created,
        expires: waiver.expires,
        expiry: expiryOf(days),
        days,
        registerBranch: null,
        covers: waiver.covers,
        uses: use?.uses ?? 0,
        newestPull: use?.newestPull ?? null,
      });
    }
  }
  rows.sort((a, b) => compareWaiverKeys(waiverKey(a), waiverKey(b)));

  const eventOnly: WaiverRowData[] = [];
  for (const [key, use] of uses) {
    if (seen.has(key)) continue;
    const { repo, id } = use;
    const repoId = repo.id;
    const register = registerById.get(repoId);
    const file = register === undefined ? undefined : files.get(repoId)?.waiverRegister;
    const read = file?.state === "ok" && file.fields !== null;
    eventOnly.push({
      repoId,
      repo: repo.fullName,
      id,
      owner: null,
      approvedBy: null,
      created: null,
      expires: null,
      expiry: read ? "not_in_register" : "register_not_read",
      days: null,
      registerBranch: read ? (file.ref ?? register?.fileBranch ?? null) : null,
      covers: null,
      uses: use.uses,
      newestPull: use.newestPull,
    });
  }
  eventOnly.sort((a, b) => compareWaiverKeys(waiverKey(a), waiverKey(b)));
  return [...rows, ...eventOnly];
}
