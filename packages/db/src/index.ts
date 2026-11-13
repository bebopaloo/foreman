import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, "..", "migrations");
const STATEMENT_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_SECONDS = 5;

export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 10,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Database = ReturnType<typeof createDatabase>["db"];

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export { schema };
