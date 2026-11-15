CREATE TABLE "user_messages" (
	"record_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"project_key" text NOT NULL,
	"branch" text
);
--> statement-breakpoint
CREATE INDEX "user_messages_time_idx" ON "user_messages" USING btree ("time");--> statement-breakpoint
CREATE INDEX "user_messages_session_id_idx" ON "user_messages" USING btree ("session_id");