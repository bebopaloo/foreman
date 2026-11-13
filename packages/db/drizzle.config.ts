import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url },
});
