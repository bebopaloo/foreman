import path from "node:path";
import { sql } from "drizzle-orm";
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

const DUPLICATE_DATABASE = "42P04";

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error) return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

/** Creates the database that the URL names on its server, unless it exists. For tests and local tools only. */
export async function ensureDatabase(url: string): Promise<void> {
  const server = new URL(url);
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

export { schema };
