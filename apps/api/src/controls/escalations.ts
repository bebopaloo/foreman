import type { ControlEvent } from "../dash/control-events.ts";

/** A repo of the scope, found by the `owner/name` of its events. */
export interface EventRepo {
  id: string;
  fullName: string;
}

export const ESCALATION_ROWS_SHOWN = 50;
const EVIDENCE_MAX = 200;

export interface EscalationRow {
  repoId: string;
  repo: string;
  path: string;
  count: number;
  pathTier: string | null;
  tier: string | null;
  latestAt: Date;
  latestPull: number;
  evidence: string | null;
}

/** The repos by lower-case `owner/name`, which is how the events name a repo. */
export function reposByFullName(repos: readonly EventRepo[]): Map<string, EventRepo> {
  return new Map(repos.map((repo) => [repo.fullName.toLowerCase(), repo]));
}

function pathsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const paths = list.filter((item): item is string => typeof item === "string" && item !== "");
  return [...new Set(paths)];
}

function evidenceFor(value: unknown, path: string): string | null {
  const candidates = Array.isArray(value) ? value : [value];
  const texts = candidates.filter((item): item is string => typeof item === "string");
  const own = texts.find((text) => text === path || text.startsWith(`${path}:`));
  const chosen = own ?? (texts.length === 1 && !Array.isArray(value) ? texts[0] : undefined);
  return chosen === undefined || chosen === "" ? null : chosen.slice(0, EVIDENCE_MAX);
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One row for each repo and path of the `escalated` events that the reader gave. An event with
 * two paths adds one to each path. The tiers, the pull request and the evidence come from the
 * newest event of the path; of two events with the same time, the later one wins.
 * The order is the count (high to low), the newest time, the repo ID and the path.
 */
export function buildEscalations(
  events: readonly ControlEvent[],
  repos: readonly EventRepo[],
): EscalationRow[] {
  const known = reposByFullName(repos);
  const rows = new Map<string, EscalationRow>();
  for (const event of events) {
    if (event.kind !== "escalated") continue;
    const repo = known.get(event.repo.toLowerCase());
    if (repo === undefined) continue;
    for (const path of pathsOf(event.paths)) {
      const key = JSON.stringify([repo.id, path]);
      const before = rows.get(key);
      const latest = {
        pathTier: event.path_tier,
        tier: event.tier,
        latestAt: event.at,
        latestPull: event.pr,
        evidence: evidenceFor(event.evidence, path),
      };
      const newest = before === undefined || event.at.getTime() >= before.latestAt.getTime();
      rows.set(key, {
        ...(newest ? latest : before),
        repoId: repo.id,
        repo: repo.fullName,
        path,
        count: (before?.count ?? 0) + 1,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.latestAt.getTime() - a.latestAt.getTime() ||
      byText(a.repoId, b.repoId) ||
      byText(a.path, b.path),
  );
}

export function countRepeated(rows: readonly EscalationRow[]): number {
  return rows.filter((row) => row.count >= 2).length;
}
