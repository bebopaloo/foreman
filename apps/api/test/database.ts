import { createDatabase, migrateDatabase } from "@foreman/db";
import { loadConfig } from "../src/config.ts";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app:app@127.0.0.1:55432/app_test";

export const testConfig = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, LOG_LEVEL: "silent" });

/** A real Postgres database with the migrations applied. Start it with `docker compose up -d db`. */
export async function openTestDatabase() {
  const database = createDatabase(TEST_DATABASE_URL);
  await migrateDatabase(database.db);
  return database;
}
