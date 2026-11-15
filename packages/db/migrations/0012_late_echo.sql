CREATE TABLE "work_forge_files" (
	"repo_id" text NOT NULL,
	"path" text NOT NULL,
	"ref" text,
	"sha" text,
	"size" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"error_class" text,
	"skipped" jsonb,
	"fields" jsonb,
	CONSTRAINT "work_forge_files_repo_id_path_pk" PRIMARY KEY("repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "work_repos" ADD COLUMN "default_branch" text;--> statement-breakpoint
ALTER TABLE "work_repos" ADD COLUMN "file_branch" text;--> statement-breakpoint
ALTER TABLE "work_repos" ADD COLUMN "repo_state" text;--> statement-breakpoint
ALTER TABLE "work_repos" ADD COLUMN "repo_error_class" text;--> statement-breakpoint
ALTER TABLE "work_repos" ADD COLUMN "forge_files_ended_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "work_forge_files_repo_id_idx" ON "work_forge_files" USING btree ("repo_id");