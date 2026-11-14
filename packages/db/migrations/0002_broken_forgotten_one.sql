CREATE TABLE "file_cursors" (
	"path" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"modified_ms" bigint NOT NULL,
	"byte_offset" bigint NOT NULL,
	"head_hash" text NOT NULL,
	"tail_hash" text NOT NULL
);
