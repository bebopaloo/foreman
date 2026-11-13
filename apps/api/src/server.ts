import { createDatabase } from "@foreman/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, db: database.db });
app.addHook("onClose", async () => {
  await database.close();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
