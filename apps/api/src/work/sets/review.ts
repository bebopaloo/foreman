import type { REVIEW_SETS } from "@foreman/shared";
import type { SetEnv, SetResult } from "./types.ts";

export type ReviewSetName = (typeof REVIEW_SETS)[number];

/** The sets `tier_*`, `round_*`, `escalated` and `waivers`: the pull requests behind a Review health number. */
export function reviewSet(_env: SetEnv, set: ReviewSetName): SetResult {
  return { refs: [], events: set === "escalated" || set === "waivers" ? 0 : null };
}
