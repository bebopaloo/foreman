CREATE TABLE "agent_starts" (
	"call_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text,
	"time" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_calls" (
	"call_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text,
	"message_id" text,
	"time" timestamp with time zone NOT NULL,
	"skill_name" text NOT NULL,
	"project_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "skill_name" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "skill_basis" text;--> statement-breakpoint
CREATE INDEX "agent_starts_session_id_idx" ON "agent_starts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "skill_calls_session_id_idx" ON "skill_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "skill_calls_time_idx" ON "skill_calls" USING btree ("time");