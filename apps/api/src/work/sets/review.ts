import type { REVIEW_SETS, WorkItemContext } from "@foreman/shared";
import { connectedWork } from "../../dash/dash.ts";
import { pullRecords, type PullRecord } from "../../dash/review-health.ts";
import { linkFor } from "../lists.ts";
import type { RepoEntry } from "../repo-list.ts";
import type { SetEnv, SetRef, SetResult } from "./types.ts";

export type ReviewSetName = (typeof REVIEW_SETS)[number];

type ReviewDetail = Extract<WorkItemContext, { kind: "review" }>["detail"];

const TIER_OF: Partial<Record<ReviewSetName, string | null>> = {
  tier_authority: "authority",
  tier_sensitive: "sensitive",
  tier_general: "general",
  tier_inert: "inert",
  tier_none: null,
};

const ROUND_OF: Partial<Record<ReviewSetName, number>> = { round_1: 1, round_2: 2, round_3: 3 };

function isMember(record: PullRecord, set: ReviewSetName): boolean {
  if (set === "escalated") return record.escalations.length > 0;
  if (set === "waivers") return record.waivers.length > 0;
  const round = ROUND_OF[set];
  if (round !== undefined) return record.highestRound === round;
  return record.firstRound !== null && record.firstRound.tier === (TIER_OF[set] ?? null);
}

function detailOf(record: PullRecord, set: ReviewSetName): ReviewDetail {
  if (set === "escalated") return { type: "escalations", events: record.escalations };
  if (set === "waivers") return { type: "waivers", ids: record.waivers };
  if (ROUND_OF[set] !== undefined) return { type: "round", round: record.highestRound ?? 1 };
  return { type: "decision", decision: record.firstRound?.passed === true ? "pass" : "fail" };
}

/**
 * The sets `tier_*`, `round_*`, `escalated` and `waivers`: the pull requests behind a Review health
 * number, from the same reduction as the dash. A Control event repo that is not in the repo list has
 * no repo ID, so its rows show only in the scope "All".
 */
export function reviewSet(env: SetEnv, set: ReviewSetName): SetResult {
  const { scope } = env;
  const { controls, repoList } = env.sources;
  const entries: RepoEntry[] = repoList.status === "ok" ? repoList.repos : [];
  const byName = new Map<string, RepoEntry>();
  for (const entry of entries) {
    if (entry.owner === null || entry.name === null) continue;
    const key = `${entry.owner}/${entry.name}`.toLowerCase();
    if (!byName.has(key)) byName.set(key, entry);
  }
  // A Client scope uses the events of the repos of that client only, as the dash does.
  const scopeRepos =
    scope.kind === "all"
      ? null
      : new Set(
          entries
            .filter((entry) => entry.client === scope.client)
            .map((entry) => `${entry.owner ?? ""}/${entry.name ?? ""}`.toLowerCase()),
        );
  const members = pullRecords(controls.events, scopeRepos).filter((record) =>
    isMember(record, set),
  );

  const cached = new Map(
    connectedWork(env.sources, scope).pulls.map((pull) => [
      `${pull.repoId}#${pull.number.toString()}`,
      pull,
    ]),
  );
  const refs = members.map((record): SetRef => {
    const entry = byName.get(record.repoKey);
    const repo = entry === undefined ? record.repo : `${entry.owner ?? ""}/${entry.name ?? ""}`;
    const pull =
      entry === undefined ? undefined : cached.get(`${entry.id}#${record.pr.toString()}`);
    return {
      repoId: entry?.id ?? null,
      repo,
      client: entry?.client ?? null,
      // The pull request alone: the Work view finds its cached issue, and shows this pull request.
      issue: null,
      pull: record.pr,
      context: {
        kind: "review",
        pullRequest: record.pr,
        link: entry === undefined ? null : linkFor(pull?.link ?? null, entry),
        detail: detailOf(record, set),
      },
      key: [0, repo, record.pr, entry?.id ?? record.repoKey, 1],
    };
  });

  let events: number | null = null;
  if (set === "escalated") {
    events = members.reduce((sum, record) => sum + record.escalations.length, 0);
  } else if (set === "waivers") {
    const distinct = new Set(
      members.flatMap((record) => record.waivers.map((id) => JSON.stringify([record.repoKey, id]))),
    );
    events = distinct.size;
  }
  return { refs, events };
}
