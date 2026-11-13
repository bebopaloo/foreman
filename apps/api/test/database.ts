import { createHash } from "node:crypto";
import path from "node:path";
import { createDatabase, migrateDatabase } from "@foreman/db";
import { sql } from "drizzle-orm";
import { loadConfig } from "../src/config.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const DEFAULT_DB_PORT = "55432";
// Postgres keeps 63 bytes of a name. The prefix takes 9 of them.
const MAX_SLUG = 54;
const DUPLICATE_DATABASE = "42P04";

/**
 * The test database for a checkout folder: `app_test_<slug>`, so that each git
 * worktree has its own database on the shared local server.
 */
export function worktreeDatabaseName(folder: string): string {
  const slug = folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug === "") {
    throw new Error(
      `Cannot name a test database from the folder "${folder}". Set TEST_DATABASE_URL.`,
    );
  }
  if (slug.length <= MAX_SLUG) return `app_test_${slug}`;
  const hash = createHash("sha256").update(folder).digest("hex").slice(0, 8);
  return `app_test_${slug.slice(0, MAX_SLUG - hash.length - 1)}_${hash}`;
}

export function worktreeDatabaseUrl(folder: string, dbPort = DEFAULT_DB_PORT): string {
  return `postgres://app@127.0.0.1:${dbPort}/${worktreeDatabaseName(folder)}`;
}

const callerDatabaseUrl = process.env.TEST_DATABASE_URL;

export const TEST_DATABASE_URL =
  callerDatabaseUrl ?? worktreeDatabaseUrl(path.basename(REPO_ROOT), process.env.DB_PORT);

export const testConfig = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, LOG_LEVEL: "silent" });

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error) return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

// A database that TEST_DATABASE_URL names belongs to the caller, so only the
// derived database is created here. Two test runs can race to create it.
async function createTestDatabaseIfMissing(): Promise<void> {
  if (callerDatabaseUrl !== undefined) return;
  const server = new URL(TEST_DATABASE_URL);
  const name = server.pathname.slice(1);
  server.pathname = "/postgres";
  const maintenance = createDatabase(server.toString());
  try {
    await maintenance.db.execute(sql`create database ${sql.identifier(name)}`);
  } catch (error) {
    if (errorCode(error) !== DUPLICATE_DATABASE) throw error;
  } finally {
    await maintenance.close();
  }
}

/**
 * A real Postgres database with the migrations applied. Start the server with
 * `docker compose up -d --wait db`. Without TEST_DATABASE_URL, the database is
 * `app_test_<folder>` and is created when it does not exist.
 */
export async function openTestDatabase() {
  await createTestDatabaseIfMissing();
  const database = createDatabase(TEST_DATABASE_URL);
  await migrateDatabase(database.db);
  return database;
}
