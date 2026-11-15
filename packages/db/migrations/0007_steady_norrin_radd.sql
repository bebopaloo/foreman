CREATE TABLE "limit_readings" (
	"session_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"window" text NOT NULL,
	"used_percentage" double precision NOT NULL,
	"resets_at" timestamp with time zone NOT NULL,
	CONSTRAINT "limit_readings_session_id_time_window_pk" PRIMARY KEY("session_id","time","window")
);
--> statement-breakpoint
CREATE INDEX "limit_readings_resets_at_idx" ON "limit_readings" USING btree ("resets_at");--> statement-breakpoint
CREATE INDEX "limit_readings_time_idx" ON "limit_readings" USING btree ("time");