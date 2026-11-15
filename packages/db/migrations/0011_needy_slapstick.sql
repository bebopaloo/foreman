CREATE TABLE "work_commit_statuses" (
	"repo_id" text NOT NULL,
	"pull_request_number" integer NOT NULL,
	"context" text NOT NULL,
	"sha" text NOT NULL,
	"state" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_commit_statuses_repo_id_pull_request_number_context_pk" PRIMARY KEY("repo_id","pull_request_number","context")
);
--> statement-breakpoint
ALTER TABLE "work_pull_requests" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "work_pull_requests" ADD COLUMN "linked_issue" integer;--> statement-breakpoint
CREATE INDEX "work_commit_statuses_repo_id_idx" ON "work_commit_statuses" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "work_pull_requests_repo_id_linked_issue_idx" ON "work_pull_requests" USING btree ("repo_id","linked_issue");