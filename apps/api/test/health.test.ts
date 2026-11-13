import { createDatabase } from "@foreman/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, TEST_DATABASE_URL, testConfig } from "./database.ts";

describe("GET /api/health", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it("reports ok when the database answers", async () => {
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("reports unavailable when the database is down", async () => {
    const closed = createDatabase(TEST_DATABASE_URL);
    await closed.close();
    const app = await buildApp({ config: testConfig, db: closed.db, logger: false });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    await app.close();
  });

  it("sends security headers", async () => {
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });
});

describe("route auth decision", () => {
  it("refuses to start with a route that has no auth decision", async () => {
    const database = createDatabase(TEST_DATABASE_URL);
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    expect(() => app.get("/api/open", () => ({ open: true }))).toThrow(/no auth decision/);
    await app.close();
    await database.close();
  });
});
