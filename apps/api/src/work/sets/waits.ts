import { allWaitItems } from "../../dash/waits.ts";
import { blockedReasonsOf, connectedWork } from "../../dash/dash.ts";
import type { SetEnv, SetResult } from "./types.ts";

/** The set `waits`: every item of Waits for you, not only the first 20, in the order of the dash. */
export function waitsSet(env: SetEnv): SetResult {
  const { connected, issues, pulls, repoLabels } = connectedWork(env.sources, env.scope);
  const clients = new Map(connected.map((entry) => [entry.id, entry.client]));
  const items = allWaitItems({
    issues,
    pulls,
    repoLabels,
    blockedReasons: blockedReasonsOf(env.sources),
  });
  return {
    events: null,
    refs: items.map((item, position) => {
      const isRelease = item.kind === "release";
      return {
        repoId: item.repoId,
        repo: item.repo,
        client: clients.get(item.repoId) ?? null,
        issue: isRelease ? null : item.number,
        pull: isRelease ? item.number : null,
        context: { kind: "wait", wait: item.kind, reason: item.reason, source: item.source },
        key: [position, "", 0, item.repoId, isRelease ? 1 : 0],
      };
    }),
  };
}
