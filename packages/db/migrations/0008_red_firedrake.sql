CREATE TABLE "work_forge_releases" (
	"repo_id" text NOT NULL,
	"tag" text NOT NULL,
	"target_commit" text,
	"asset_names" text[] DEFAULT '{}' NOT NULL,
	"link" text,
	"no_forge_release" boolean DEFAULT false NOT NULL,
	CONSTRAINT "work_forge_releases_repo_id_tag_pk" PRIMARY KEY("repo_id","tag")
);
--> statement-breakpoint
CREATE TABLE "work_issues" (
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"issue_state" text NOT NULL,
	"priority" text NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"author" text NOT NULL,
	"link" text,
	"parent" integer,
	"children" integer[] DEFAULT '{}' NOT NULL,
	"blocked_by" integer[] DEFAULT '{}' NOT NULL,
	"last_listed_at" timestamp with time zone NOT NULL,
	"details_fetched_at" timestamp with time zone,
	"details_error_class" text,
	CONSTRAINT "work_issues_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
CREATE TABLE "work_pull_requests" (
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"author" text NOT NULL,
	"checks" text NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"link" text,
	"last_listed_at" timestamp with time zone NOT NULL,
	"details_fetched_at" timestamp with time zone,
	"details_error_class" text,
	CONSTRAINT "work_pull_requests_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
CREATE TABLE "work_releases" (
	"repo_id" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"link" text,
	"issue_numbers" integer[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "work_releases_repo_id_name_pk" PRIMARY KEY("repo_id","name")
);
--> statement-breakpoint
CREATE TABLE "work_reviews" (
	"repo_id" text NOT NULL,
	"pull_request_number" integer NOT NULL,
	"position" integer NOT NULL,
	"author" text NOT NULL,
	"state" text NOT NULL,
	"commit" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	CONSTRAINT "work_reviews_repo_id_pull_request_number_position_pk" PRIMARY KEY("repo_id","pull_request_number","position")
);
--> statement-breakpoint
CREATE INDEX "work_forge_releases_repo_id_idx" ON "work_forge_releases" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "work_issues_repo_id_idx" ON "work_issues" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "work_issues_issue_state_idx" ON "work_issues" USING btree ("issue_state");--> statement-breakpoint
CREATE INDEX "work_pull_requests_repo_id_idx" ON "work_pull_requests" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "work_releases_repo_id_idx" ON "work_releases" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "work_reviews_repo_id_idx" ON "work_reviews" USING btree ("repo_id");