import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, testConfig } from "./database.ts";

describe("Host check", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it("rejects a foreign Host header with 421 and does not run the route", async () => {
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    let ran = false;
    app.get("/api/probe", { config: { public: true } }, () => {
      ran = true;
      return { ran };
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/probe",
      headers: { host: "evil.example" },
    });
    expect(response.statusCode).toBe(421);
    expect(ran).toBe(false);
    await app.close();
  });

  it("rejects a foreign Host header on the health route", async () => {
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example:47130" },
    });
    expect(response.statusCode).toBe(421);
    await app.close();
  });

  it.each([
    "127.0.0.1",
    "127.0.0.1:47130",
    "localhost",
    "localhost:47173",
    "LOCALHOST:8080",
    "[::1]",
    "[::1]:47130",
  ])("accepts the loopback Host %s", async (host) => {
    const app = await buildApp({ config: testConfig, db: database.db, logger: false });
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host } });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it.each(["127.0.0.1.evil.example", "localhost.evil.example:47130", "evil.example/127.0.0.1"])(
    "rejects the look-alike Host %j",
    async (host) => {
      const app = await buildApp({ config: testConfig, db: database.db, logger: false });
      const response = await app.inject({ method: "GET", url: "/api/health", headers: { host } });
      expect(response.statusCode).toBe(421);
      await app.close();
    },
  );
});
