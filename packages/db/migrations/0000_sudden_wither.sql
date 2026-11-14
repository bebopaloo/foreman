CREATE TABLE "refresh_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"state" text NOT NULL,
	"files_total" integer DEFAULT 0 NOT NULL,
	"files_read" integer DEFAULT 0 NOT NULL,
	"turns_added" integer DEFAULT 0 NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"turn_key" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"speed" text,
	"service_tier" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_write_5m_tokens" integer NOT NULL,
	"cache_write_1h_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"web_search_count" integer NOT NULL,
	"project_key" text NOT NULL,
	"branch" text,
	"agent_type" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "turns_time_idx" ON "turns" USING btree ("time");--> statement-breakpoint
CREATE INDEX "turns_project_key_idx" ON "turns" USING btree ("project_key");--> statement-breakpoint
CREATE INDEX "turns_session_id_idx" ON "turns" USING btree ("session_id");