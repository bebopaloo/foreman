import type { WorkItemContext } from "@foreman/shared";
import type { CursorKey } from "../../paging.ts";
import type { DashSources } from "../../dash/dash.ts";
import type { RunScope } from "../../dash/runs.ts";

/** What a set reads: the files and the Work cache that the dash reads, in the scope of the request. */
export interface SetEnv {
  sources: DashSources;
  scope: RunScope;
  /** The clock of the request. */
  now: Date;
}

/**
 * One row of a set, before it meets the Work cache. `items.ts` resolves it to a Work view row:
 *
 * - `issue` set: the row of that cached issue. With `pull` set too, the row shows that pull request
 *   and not the Linked pull request.
 * - `issue` null and `pull` set: the row of that cached pull request, with its cached issue when it has one.
 * - Nothing found in the Work cache: a row with `repo`, the number and no issue, no pull request.
 */
export interface SetRef {
  /** The repo ID, or null for a folder or a Control event repo that is not in the repo list. */
  repoId: string | null;
  /** `owner/name`, or the folder label. */
  repo: string;
  client: string | null;
  issue: number | null;
  pull: number | null;
  context: WorkItemContext | null;
  /**
   * The total order of the set: `[group, text, number, tie, kind]`. Compared with the group and the
   * text from low to high, then the number from HIGH to LOW (store a negative number for low to
   * high), then the tie (the repo ID or the folder label) and the kind (0 issue, 1 pull request).
   */
  key: CursorKey;
}

export interface SetResult {
  refs: SetRef[];
  /** `escalated`: the count of events. `waivers`: the count of distinct Waivers. Else null. */
  events: number | null;
}
