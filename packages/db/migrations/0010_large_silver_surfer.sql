CREATE TABLE "work_release_records" (
	"repo_id" text NOT NULL,
	"tag" text NOT NULL,
	"asset_name" text,
	"size" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"error_class" text,
	"fields" jsonb,
	CONSTRAINT "work_release_records_repo_id_tag_pk" PRIMARY KEY("repo_id","tag")
);
--> statement-breakpoint
CREATE INDEX "work_release_records_repo_id_idx" ON "work_release_records" USING btree ("repo_id");