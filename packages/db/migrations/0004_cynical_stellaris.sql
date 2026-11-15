CREATE TABLE "agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"start_tool_call_id" text
);
--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "agent_id" text;