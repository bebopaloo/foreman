import type { SetEnv, SetResult } from "./types.ts";

/** The sets `builds` and `merged`: the builds of the run `run`, by the Spec 24 rules. */
// The parameters are the final signature: this function returns no rows until its own issue fills it in.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildsSet(_env: SetEnv, _set: "builds" | "merged", _run: string): SetResult {
  return { refs: [], events: null };
}
