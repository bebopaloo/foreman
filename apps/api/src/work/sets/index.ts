import { BUILD_SETS, REVIEW_SETS, STAGE_SETS, type WorkSet } from "@foreman/shared";
import { connectedWork } from "../../dash/dash.ts";
import { buildsSet } from "./builds.ts";
import { reviewSet } from "./review.ts";
import { stageSet } from "./stages.ts";
import type { SetEnv, SetResult } from "./types.ts";
import { waitsSet } from "./waits.ts";

export type { SetEnv, SetRef, SetResult } from "./types.ts";

type FolderState = "ok" | "missing" | "unreadable";

export interface SetSelection extends SetResult {
  /** False when no repo in scope is connected: the dash shows "Not connected". */
  connected: boolean;
  /** The state of the two factory folders, by the rules of the dash. */
  sources: { runs: FolderState; controls: FolderState };
}

const oneOf = <T extends string>(values: readonly T[], value: string): T | undefined =>
  values.find((candidate) => candidate === value);

/** The rows of one `set` value. `run` is the run ID, for `builds` and `merged`. */
export function selectSet(env: SetEnv, set: WorkSet, run: string | undefined): SetSelection {
  const connected = connectedWork(env.sources, env.scope).connected.length > 0;
  const sources = {
    runs: env.sources.nightLog.folder,
    controls: env.sources.controls.folder,
  };
  const build = oneOf(BUILD_SETS, set);
  if (build !== undefined) {
    // The night log is local: the builds show with no repo connected.
    return { ...buildsSet(env, build, run ?? ""), connected, sources };
  }
  const review = oneOf(REVIEW_SETS, set);
  if (review !== undefined) return { ...reviewSet(env, review), connected, sources };
  // The stage sets and Waits for you come from the Work cache: with no connected repo they have no rows.
  if (!connected) return { refs: [], events: null, connected, sources };
  const stage = oneOf(STAGE_SETS, set);
  const result = stage === undefined ? waitsSet(env) : stageSet(env, stage);
  return { ...result, connected, sources };
}
