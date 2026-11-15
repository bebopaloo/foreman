import { createDatabase, schema } from "@foreman/db";

/** Clears the Usage index of the e2e database, so a fixture set starts from its own transcripts. */
export async function clearUsageIndex(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl);
  try {
    await database.db.transaction(async (tx) => {
      await tx.delete(schema.turns);
      await tx.delete(schema.agents);
      await tx.delete(schema.userMessages);
      await tx.delete(schema.skillCalls);
      await tx.delete(schema.agentStarts);
      await tx.delete(schema.limitReadings);
      await tx.delete(schema.fileCursors);
      await tx.delete(schema.projects);
    });
  } finally {
    await database.close();
  }
}
