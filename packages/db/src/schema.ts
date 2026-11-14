import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    agentType: text("agent_type").notNull(),
  },
  (table) => [
    index("turns_time_idx").on(table.time),
    index("turns_project_key_idx").on(table.projectKey),
    index("turns_session_id_idx").on(table.sessionId),
  ],
);

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
});

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
