import { createDatabase, migrateDatabase } from "@foreman/db";
import { z } from "zod";

// Applies the committed migrations. drizzle-kit is a dev tool; this script
// needs only the runtime packages, so it runs in the API image.
const url = z.url({ protocol: /^postgres(ql)?$/ }).parse(process.env.DATABASE_URL);
const database = createDatabase(url);
try {
  await migrateDatabase(database.db);
} finally {
  await database.close();
}
