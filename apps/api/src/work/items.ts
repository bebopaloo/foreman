import { schema, type Database } from "@foreman/db";
import {
  GATE_EVENT_VALUES,
  GATE_FORGE_VALUES,
  ISSUE_STATES,
  ISSUE_TYPES,
  PRIORITIES,
  RISK_TIERS,
  type WorkItem,
  type WorkItemsQuery,
  type WorkItemsResponse,
} from "@foreman/shared";
import { and, eq, inArray } from "drizzle-orm";
import { paginate, type CursorKey } from "../paging.ts";
import { pullKey, type GateSignals } from "./gate-signals.ts";
import { linkFor, newestListing } from "./lists.ts";
import type { RepoEntry } from "./repo-list.ts";
import type { ScopedRepo } from "./scope.ts";
import type { SetRef } from "./sets/types.ts";

const MACHINE_GATE_CONTEXT = "factory/machine-gate";

export interface ItemsRepo extends ScopedRepo {
  /** `owner/name`. */
  fullName: string;
  client: string | null;
}

export interface ItemsFilters {
  issue_state: WorkItemsQuery["issue_state"];
  type: WorkItemsQuery["type"];
  priority: WorkItemsQuery["priority"];
  sort: WorkItemsQuery["sort"];
}

/** The rows of a `set`, from `sets/`. Each ref becomes a Work view row. */
export interface SetInput {
  refs: readonly SetRef[];
  /** False when no repo in scope is connected. */
  connected: boolean;
  events: number | null;
  sources: NonNullable<WorkItemsResponse["sources"]>;
}

export interface ItemsInput {
  /** The repos that the route may read. */
  repos: readonly ItemsRepo[];
  /** Every repo list entry of the scope, the repos with no token among them. */
  inScope: readonly RepoEntry[];
  signals: GateSignals;
  filters: ItemsFilters;
  /** With a set, the rows and their order come from the set and the filters do not apply. */
  set?: SetInput | undefined;
  limit: number;
  cursor: string | undefined;
  /** The query values that the cursor is bound to. */
  cursorQuery: Readonly<Record<string, string | undefined>>;
}

export type ItemsResult = Omit<WorkItemsResponse, "skipped">;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function oneOf<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value);
}

type IssueType = (typeof ISSUE_TYPES)[number];

function typeOf(labels: readonly string[]): IssueType | "multiple" | null {
  const found = new Set<IssueType>();
  for (const label of labels) {
    if (!label.startsWith("type:")) continue;
    const type = oneOf(ISSUE_TYPES, label.slice("type:".length));
    if (type !== undefined) found.add(type);
  }
  if (found.size > 1) return "multiple";
  return [...found][0] ?? null;
}

function riskTierOf(labels: readonly string[]): (typeof RISK_TIERS)[number] | null {
  const found = new Set(labels);
  return RISK_TIERS.find((tier) => found.has(`risk:${tier}`)) ?? null;
}

function priorityOf(value: string): (typeof PRIORITIES)[number] | "none" {
  return oneOf(PRIORITIES, value) ?? "none";
}

interface PullRow {
  repoId: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  checks: string;
  labels: string[];
  link: string | null;
  headSha: string | null;
  linkedIssue: number | null;
  lastListedAt: Date;
}

/** The open pull request with the highest number, else the one with the highest number. */
function shown(pulls: readonly PullRow[]): PullRow | undefined {
  const open = pulls.filter((pull) => pull.state === "open");
  const pool = open.length > 0 ? open : pulls;
  return pool.reduce<PullRow | undefined>(
    (best, pull) => (pull.number > (best?.number ?? 0) ? pull : best),
    undefined,
  );
}

function gateOf(
  pull: PullRow,
  repo: ItemsRepo,
  statusSha: ReadonlyMap<string, { sha: string; state: string }>,
  signals: GateSignals,
): WorkItem["machineGate"] {
  const status = statusSha.get(`${pull.repoId}#${pull.number.toString()}`);
  if (pull.headSha !== null && status?.sha === pull.headSha) {
    const value = oneOf(GATE_FORGE_VALUES, status.state);
    if (value !== undefined) return { source: "forge", value };
  }
  const event = signals.byPull.get(pullKey(repo.fullName, pull.number));
  if (event === undefined) return null;
  const value = oneOf(GATE_EVENT_VALUES, event.decision);
  return value === undefined ? null : { source: "events", value };
}

interface Row {
  item: WorkItem;
  /** The number of the issue, or of the pull request in a row with no issue. */
  number: number;
  /** 0 for a row with an issue, 1 for a row with a pull request only. */
  kind: 0 | 1;
}

const STATE_RANK = new Map<string, number>(ISSUE_STATES.map((state, index) => [state, index]));
const PRIORITY_RANK = new Map<string, number>(
  [...PRIORITIES, "none"].map((priority, index) => [priority, index]),
);

/** The group of a row in the chosen sort. Rows with no issue come last. */
function groupOf(row: Row, sort: ItemsFilters["sort"]): number {
  if (sort === "repo") return 0;
  const { issue } = row.item;
  if (issue === null) return 100;
  if (sort === "priority") return PRIORITY_RANK.get(issue.priority) ?? 99;
  return STATE_RANK.get(issue.issueState) ?? ISSUE_STATES.length;
}

/** Group, then `owner/name`, then the number from high to low, then the repo ID and the row kind. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  return (
    Number(a[0]) - Number(b[0]) ||
    byText(String(a[1]), String(b[1])) ||
    Number(b[2]) - Number(a[2]) ||
    byText(String(a[3]), String(b[3])) ||
    Number(a[4]) - Number(b[4])
  );
}

function matches(row: Row, filters: ItemsFilters): boolean {
  const { issue } = row.item;
  const { type, priority } = filters;
  if (type === undefined && priority === undefined) return true;
  if (issue === null) return false;
  return (
    (type === undefined || (issue.type ?? "none") === type) &&
    (priority === undefined || issue.priority === priority)
  );
}

function emptyCounts(): WorkItemsResponse["counts"] {
  return {
    all: 0,
    TODO: 0,
    READY: 0,
    "IN PROGRESS": 0,
    "IN REVIEW": 0,
    BLOCKED: 0,
    DONE: 0,
    CANCELLED: 0,
    none: 0,
  };
}

function stateOf(row: Row): string {
  return row.item.issue === null ? "none" : row.item.issue.issueState;
}

/**
 * The Work rows: each cached issue with its linked pull request, and each pull request with no
 * cached issue. Three queries read the issues, the pull requests and the statuses; the rows,
 * the counts and the page come from memory.
 */
export async function listWorkItems(db: Database, input: ItemsInput): Promise<ItemsResult> {
  const { repos, inScope, signals, filters } = input;
  const ids = repos.map((repo) => repo.id);
  if (ids.length === 0 && input.set === undefined) {
    return {
      state: "not_connected",
      items: [],
      nextCursor: null,
      counts: emptyCounts(),
      complete: inScope.length,
      noControlEvents: [],
      sources: null,
      events: null,
    };
  }
  const [issueRows, pullRows, statusRows, repoRows] = await Promise.all([
    db
      .select({
        repoId: schema.workIssues.repoId,
        number: schema.workIssues.number,
        title: schema.workIssues.title,
        state: schema.workIssues.state,
        issueState: schema.workIssues.issueState,
        priority: schema.workIssues.priority,
        labels: schema.workIssues.labels,
        link: schema.workIssues.link,
        lastListedAt: schema.workIssues.lastListedAt,
      })
      .from(schema.workIssues)
      .where(inArray(schema.workIssues.repoId, ids)),
    db
      .select({
        repoId: schema.workPullRequests.repoId,
        number: schema.workPullRequests.number,
        title: schema.workPullRequests.title,
        state: schema.workPullRequests.state,
        draft: schema.workPullRequests.draft,
        checks: schema.workPullRequests.checks,
        labels: schema.workPullRequests.labels,
        link: schema.workPullRequests.link,
        headSha: schema.workPullRequests.headSha,
        linkedIssue: schema.workPullRequests.linkedIssue,
        lastListedAt: schema.workPullRequests.lastListedAt,
      })
      .from(schema.workPullRequests)
      .where(inArray(schema.workPullRequests.repoId, ids)),
    db
      .select({
        repoId: schema.workCommitStatuses.repoId,
        pullRequestNumber: schema.workCommitStatuses.pullRequestNumber,
        sha: schema.workCommitStatuses.sha,
        state: schema.workCommitStatuses.state,
      })
      .from(schema.workCommitStatuses)
      .where(
        and(
          inArray(schema.workCommitStatuses.repoId, ids),
          eq(schema.workCommitStatuses.context, MACHINE_GATE_CONTEXT),
        ),
      ),
    db
      .select({
        id: schema.workRepos.id,
        forgeErrorClass: schema.workRepos.forgeErrorClass,
        trackerErrorClass: schema.workRepos.trackerErrorClass,
        lastGoodFetchAt: schema.workRepos.lastGoodFetchAt,
      })
      .from(schema.workRepos)
      .where(inArray(schema.workRepos.id, ids)),
  ]);

  const repoById = new Map(repos.map((repo) => [repo.id, repo]));
  const statuses = new Map(
    statusRows.map((row) => [
      `${row.repoId}#${row.pullRequestNumber.toString()}`,
      { sha: row.sha, state: row.state },
    ]),
  );
  const issueStale = newestListing(issueRows);
  const pullStale = newestListing(pullRows);

  const issueKeys = new Set(issueRows.map((row) => `${row.repoId}#${row.number.toString()}`));
  const linked = new Map<string, PullRow[]>();
  const loose: PullRow[] = [];
  for (const pull of pullRows) {
    const issueKey =
      pull.linkedIssue === null ? null : `${pull.repoId}#${pull.linkedIssue.toString()}`;
    if (issueKey !== null && issueKeys.has(issueKey)) {
      linked.set(issueKey, [...(linked.get(issueKey) ?? []), pull]);
    } else {
      loose.push(pull);
    }
  }

  function pullItem(pull: PullRow, repo: ItemsRepo, others: number): Partial<WorkItem> {
    return {
      pullRequest: {
        number: pull.number,
        title: pull.title,
        state: pull.state,
        draft: pull.draft,
        checks: pull.checks,
        link: linkFor(pull.link, repo),
        stale: pullStale(pull),
        otherCount: others,
      },
      machineGate: gateOf(pull, repo, statuses, signals),
      round: signals.byPull.get(pullKey(repo.fullName, pull.number))?.round ?? null,
      riskTier: riskTierOf(pull.labels),
    };
  }

  const none = { pullRequest: null, machineGate: null, round: null, riskTier: null, context: null };

  function issueRow(issue: (typeof issueRows)[number], repo: ItemsRepo, pull: PullRow | undefined) {
    const pulls = linked.get(`${issue.repoId}#${issue.number.toString()}`) ?? [];
    const row: Row = {
      number: issue.number,
      kind: 0,
      item: {
        repoId: repo.id,
        fullName: repo.fullName,
        client: repo.client,
        issue: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          issueState: issue.issueState,
          type: typeOf(issue.labels),
          priority: priorityOf(issue.priority),
          link: linkFor(issue.link, repo),
          stale: issueStale(issue),
        },
        ...none,
        ...(pull === undefined ? {} : pullItem(pull, repo, pulls.length - 1)),
      },
    };
    return row;
  }

  function loosePullRow(pull: PullRow, repo: ItemsRepo): Row {
    return {
      number: pull.number,
      kind: 1,
      item: {
        repoId: repo.id,
        fullName: repo.fullName,
        client: repo.client,
        issue: null,
        ...none,
        ...pullItem(pull, repo, 0),
      },
    };
  }

  const issueByKey = new Map(
    issueRows.map((row) => [`${row.repoId}#${row.number.toString()}`, row]),
  );
  const pullByKey = new Map(pullRows.map((row) => [`${row.repoId}#${row.number.toString()}`, row]));

  /** The Work view row of a set ref, or the row of an item that is not in the Work cache. */
  function refRow(ref: SetRef): Row {
    const repo = ref.repoId === null ? undefined : repoById.get(ref.repoId);
    // The dash sources hold open pull requests only, so a closed pull request takes its link from the row.
    const withContext = (row: Row): Row => {
      const { context } = ref;
      const pull = row.item.pullRequest;
      const filled =
        context?.kind === "review" &&
        context.link === null &&
        pull?.number === context.pullRequest &&
        pull.link !== null
          ? { ...context, link: pull.link }
          : context;
      return { ...row, item: { ...row.item, context: filled } };
    };
    if (repo !== undefined) {
      const wanted =
        ref.pull === null ? undefined : pullByKey.get(`${repo.id}#${ref.pull.toString()}`);
      const issueNumber = ref.issue ?? wanted?.linkedIssue ?? null;
      const issue =
        issueNumber === null ? undefined : issueByKey.get(`${repo.id}#${issueNumber.toString()}`);
      if (issue !== undefined) {
        const pulls = linked.get(`${repo.id}#${issue.number.toString()}`) ?? [];
        const own = wanted !== undefined && pulls.includes(wanted) ? wanted : undefined;
        return withContext(
          issueRow(issue, repo, own ?? (ref.pull === null ? shown(pulls) : undefined)),
        );
      }
      if (wanted !== undefined) return withContext(loosePullRow(wanted, repo));
    }
    return withContext({
      number: ref.issue ?? ref.pull ?? 0,
      kind: 0,
      item: {
        repoId: ref.repoId,
        fullName: ref.repo,
        client: ref.client,
        issue: null,
        ...none,
      },
    });
  }

  const rows: Row[] = [];
  for (const issue of issueRows) {
    const repo = repoById.get(issue.repoId);
    if (repo === undefined) continue;
    const pulls = linked.get(`${issue.repoId}#${issue.number.toString()}`) ?? [];
    rows.push(issueRow(issue, repo, shown(pulls)));
  }
  for (const pull of loose) {
    const repo = repoById.get(pull.repoId);
    if (repo !== undefined) rows.push(loosePullRow(pull, repo));
  }

  const counted = (list: readonly Row[]): WorkItemsResponse["counts"] => {
    const counts = emptyCounts();
    for (const row of list) {
      counts.all += 1;
      const state = stateOf(row);
      if (state === "none") counts.none += 1;
      else {
        const known = oneOf(ISSUE_STATES, state);
        if (known !== undefined) counts[known] += 1;
      }
    }
    return counts;
  };
  const query = {
    limit: input.limit,
    cursor: input.cursor,
    query: input.cursorQuery,
    compare: compareKeys,
  };

  let page: { items: Row[]; nextCursor: string | null };
  let counts: WorkItemsResponse["counts"];
  if (input.set === undefined) {
    const inFilter = rows.filter((row) => matches(row, filters));
    counts = counted(inFilter);
    const wanted =
      filters.issue_state === undefined
        ? inFilter
        : inFilter.filter((row) => stateOf(row) === filters.issue_state);
    const keyOf = (row: Row): CursorKey => [
      groupOf(row, filters.sort),
      row.item.fullName,
      row.number,
      row.item.repoId,
      row.kind,
    ];
    const sorted = wanted
      .map((row) => ({ row, key: keyOf(row) }))
      .sort((a, b) => compareKeys(a.key, b.key));
    const paged = paginate(sorted, { ...query, keyOf: ({ key }) => key });
    page = { items: paged.items.map(({ row }) => row), nextCursor: paged.nextCursor };
  } else {
    const resolved = input.set.refs
      .map((ref) => ({ row: refRow(ref), key: ref.key }))
      .sort((a, b) => compareKeys(a.key, b.key));
    counts = counted(resolved.map(({ row }) => row));
    const paged = paginate(resolved, { ...query, keyOf: ({ key }) => key });
    page = { items: paged.items.map(({ row }) => row), nextCursor: paged.nextCursor };
  }

  const cachedRepos = new Set<string>([
    ...issueRows.map((row) => row.repoId),
    ...pullRows.map((row) => row.repoId),
    ...repoRows.filter((row) => row.lastGoodFetchAt !== null).map((row) => row.id),
  ]);
  const errored = new Set(
    repoRows
      .filter((row) => row.forgeErrorClass !== null || row.trackerErrorClass !== null)
      .map((row) => row.id),
  );
  const complete = inScope.filter((entry) => !cachedRepos.has(entry.id) || errored.has(entry.id));
  const state = input.set === undefined ? cachedRepos.size === 0 : !input.set.connected;
  return {
    state: state ? "not_connected" : "ok",
    items: page.items.map((row) => row.item),
    nextCursor: page.nextCursor,
    counts,
    complete: complete.length,
    noControlEvents: repos
      .filter(
        (repo) =>
          cachedRepos.has(repo.id) && !signals.reposWithEvents.has(repo.fullName.toLowerCase()),
      )
      .map((repo) => repo.id)
      .sort(),
    sources: input.set?.sources ?? null,
    events: input.set?.events ?? null,
  };
}
