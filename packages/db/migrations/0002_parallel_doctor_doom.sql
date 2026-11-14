CREATE TABLE "work_fetch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"repos_read" integer DEFAULT 0 NOT NULL,
	"adapter_calls" integer DEFAULT 0 NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "work_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"client" text,
	"forge_plugin" text,
	"tracker_plugin" text,
	"forge_state" text,
	"forge_error_class" text,
	"tracker_state" text,
	"tracker_error_class" text,
	"last_good_fetch_at" timestamp with time zone
);
