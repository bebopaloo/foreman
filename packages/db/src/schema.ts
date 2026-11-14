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
