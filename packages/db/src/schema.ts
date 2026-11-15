import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The Usage index. It holds counts, times, names and paths only: never a
// prompt, a reply, a tool input or a tool output.
export const turns = pgTable(
  "turns",
  {
    turnKey: text("turn_key").primaryKey(),
    sessionId: text("session_id").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    model: text("model").notNull(),
    speed: text("speed"),
    serviceTier: text("service_tier"),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheWrite5mTokens: integer("cache_write_5m_tokens").notNull(),
    cacheWrite1hTokens: integer("cache_write_1h_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    webSearchCount: integer("web_search_count").notNull(),
    projectKey: text("project_key").notNull(),
    branch: text("branch"),
    worktreeName: text("worktree_name"),
    agentType: text("agent_type").notNull(),
    agentId: text("agent_id"),
    // The skill that Skill attribution gives the turn, and whether it is exact or an estimate.
    skillName: text("skill_name"),
    skillBasis: text("skill_basis"),
  },
  (table) => [
    index("turns_time_idx").on(table.time),
    index("turns_project_key_idx").on(table.projectKey),
    index("turns_session_id_idx").on(table.sessionId),
  ],
);

// One row for each sub-agent: its Agent type and the ID of the tool call that started it.
export const agents = pgTable("agents", {
  agentId: text("agent_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  agentType: text("agent_type").notNull(),
  startToolCallId: text("start_tool_call_id"),
});

// One row for each skill call: a Skill tool call or a slash command. The ID is the tool call ID,
// or the record ID of a slash command. The message ID groups the calls of one assistant message.
export const skillCalls = pgTable(
  "skill_calls",
  {
    callId: text("call_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    agentId: text("agent_id"),
    messageId: text("message_id"),
    time: timestamp("time", { withTimezone: true }).notNull(),
    skillName: text("skill_name").notNull(),
    projectKey: text("project_key").notNull(),
  },
  (table) => [
    index("skill_calls_session_id_idx").on(table.sessionId),
    index("skill_calls_time_idx").on(table.time),
  ],
);

// One row for each tool call that starts a sub-agent. It keeps no tool input.
export const agentStarts = pgTable(
  "agent_starts",
  {
    callId: text("call_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    agentId: text("agent_id"),
    time: timestamp("time", { withTimezone: true }).notNull(),
  },
  (table) => [index("agent_starts_session_id_idx").on(table.sessionId)],
);

// The time of each real user message of a main session file. It has no text:
// the Engagement ledger and skill attribution only need the times.
export const userMessages = pgTable(
  "user_messages",
  {
    recordId: text("record_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    projectKey: text("project_key").notNull(),
    branch: text("branch"),
  },
  (table) => [
    index("user_messages_time_idx").on(table.time),
    index("user_messages_session_id_idx").on(table.sessionId),
  ],
);

// One reading of a Limit window from the capture file: the used percentage and
// the time that the window resets. It holds no text.
export const limitReadings = pgTable(
  "limit_readings",
  {
    sessionId: text("session_id").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    window: text("window").notNull(),
    usedPercentage: doublePrecision("used_percentage").notNull(),
    resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.time, table.window] }),
    index("limit_readings_resets_at_idx").on(table.resetsAt),
    index("limit_readings_time_idx").on(table.time),
  ],
);

// One row for each Project key. The key is a path, never a transcript text.
export const projects = pgTable("projects", {
  projectKey: text("project_key").primaryKey(),
  noRepo: boolean("no_repo").notNull(),
});

export const refreshRuns = pgTable("refresh_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  state: text("state").notNull(),
  filesTotal: integer("files_total").notNull().default(0),
  filesRead: integer("files_read").notNull().default(0),
  turnsAdded: integer("turns_added").notNull().default(0),
  failureReason: text("failure_reason"),
});

// One cursor for each transcript file that the ingest read: where the last
// complete line ends, and hashes of the bytes around the start and the offset.
export const fileCursors = pgTable("file_cursors", {
  path: text("path").primaryKey(),
  size: bigint("size", { mode: "number" }).notNull(),
  modifiedMs: bigint("modified_ms", { mode: "number" }).notNull(),
  offset: bigint("byte_offset", { mode: "number" }).notNull(),
  headHash: text("head_hash").notNull(),
  tailHash: text("tail_hash").notNull(),
});

// The work cache. It holds names, states and times only: never a body, a
// comment or a token.
export const workRepos = pgTable("work_repos", {
  id: text("id").primaryKey(),
  host: text("host").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  client: text("client"),
  forgePlugin: text("forge_plugin"),
  trackerPlugin: text("tracker_plugin"),
  forgeState: text("forge_state"),
  forgeErrorClass: text("forge_error_class"),
  trackerState: text("tracker_state"),
  trackerErrorClass: text("tracker_error_class"),
  lastGoodFetchAt: timestamp("last_good_fetch_at", { withTimezone: true }),
  defaultBranch: text("default_branch"),
  fileBranch: text("file_branch"),
  repoState: text("repo_state"),
  repoErrorClass: text("repo_error_class"),
  forgeFilesEndedAt: timestamp("forge_files_ended_at", { withTimezone: true }),
});

// The Issue rows keep no body and no comment. `labels`, `children` and
// `blocked_by` are lists; the relations stay as they were when a detail call fails.
export const workIssues = pgTable(
  "work_issues",
  {
    repoId: text("repo_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    issueState: text("issue_state").notNull(),
    priority: text("priority").notNull(),
    labels: text("labels").array().notNull().default([]),
    author: text("author").notNull(),
    link: text("link"),
    parent: integer("parent"),
    children: integer("children").array().notNull().default([]),
    blockedBy: integer("blocked_by").array().notNull().default([]),
    lastListedAt: timestamp("last_listed_at", { withTimezone: true }).notNull(),
    detailsFetchedAt: timestamp("details_fetched_at", { withTimezone: true }),
    detailsErrorClass: text("details_error_class"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.number] }),
    index("work_issues_repo_id_idx").on(table.repoId),
    index("work_issues_issue_state_idx").on(table.issueState),
  ],
);

export const workPullRequests = pgTable(
  "work_pull_requests",
  {
    repoId: text("repo_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    draft: boolean("draft").notNull(),
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    author: text("author").notNull(),
    checks: text("checks").notNull(),
    labels: text("labels").array().notNull().default([]),
    link: text("link"),
    lastListedAt: timestamp("last_listed_at", { withTimezone: true }).notNull(),
    detailsFetchedAt: timestamp("details_fetched_at", { withTimezone: true }),
    detailsErrorClass: text("details_error_class"),
    headSha: text("head_sha"),
    linkedIssue: integer("linked_issue"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.number] }),
    index("work_pull_requests_repo_id_idx").on(table.repoId),
    index("work_pull_requests_repo_id_linked_issue_idx").on(table.repoId, table.linkedIssue),
  ],
);

// One row for each pull request and status context. It has no description.
export const workCommitStatuses = pgTable(
  "work_commit_statuses",
  {
    repoId: text("repo_id").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    context: text("context").notNull(),
    sha: text("sha").notNull(),
    state: text("state").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.pullRequestNumber, table.context] }),
    index("work_commit_statuses_repo_id_idx").on(table.repoId),
  ],
);

// One row for each review. It has no body.
export const workReviews = pgTable(
  "work_reviews",
  {
    repoId: text("repo_id").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    position: integer("position").notNull(),
    author: text("author").notNull(),
    state: text("state").notNull(),
    commit: text("commit").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.pullRequestNumber, table.position] }),
    index("work_reviews_repo_id_idx").on(table.repoId),
  ],
);

export const workReleases = pgTable(
  "work_releases",
  {
    repoId: text("repo_id").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    link: text("link"),
    issueNumbers: integer("issue_numbers").array().notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.name] }),
    index("work_releases_repo_id_idx").on(table.repoId),
  ],
);

export const workForgeReleases = pgTable(
  "work_forge_releases",
  {
    repoId: text("repo_id").notNull(),
    tag: text("tag").notNull(),
    targetCommit: text("target_commit"),
    assetNames: text("asset_names").array().notNull().default([]),
    link: text("link"),
    noForgeRelease: boolean("no_forge_release").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.tag] }),
    index("work_forge_releases_repo_id_idx").on(table.repoId),
  ],
);

export const workReleaseRecords = pgTable(
  "work_release_records",
  {
    repoId: text("repo_id").notNull(),
    tag: text("tag").notNull(),
    assetName: text("asset_name"),
    size: integer("size"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    errorClass: text("error_class"),
    fields: jsonb("fields"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.tag] }),
    index("work_release_records_repo_id_idx").on(table.repoId),
  ],
);

// A Forge file row keeps parsed fields only, never the content of the file.
export const workForgeFiles = pgTable(
  "work_forge_files",
  {
    repoId: text("repo_id").notNull(),
    path: text("path").notNull(),
    ref: text("ref"),
    sha: text("sha"),
    size: integer("size"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    errorClass: text("error_class"),
    skipped: jsonb("skipped"),
    fields: jsonb("fields"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.path] }),
    index("work_forge_files_repo_id_idx").on(table.repoId),
  ],
);

export const workFetchRuns = pgTable("work_fetch_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  reposRead: integer("repos_read").notNull().default(0),
  adapterCalls: integer("adapter_calls").notNull().default(0),
  failureReason: text("failure_reason"),
});
