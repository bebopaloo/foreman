import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { RefreshStatus, Refresher } from "../src/usage/refresh.ts";
import { testConfig } from "./database.ts";

const RUNNING: RefreshStatus = {
  state: "running",
  filesRead: 1240,
  filesTotal: 3100,
  dataAsOf: null,
  reason: null,
};

function fakeRefresher(status: RefreshStatus = RUNNING) {
  const seen = { triggers: 0, stops: 0 };
  const refresher: Refresher = {
    trigger: () => {
      seen.triggers += 1;
      return Promise.resolve();
    },
    status: () => Promise.resolve(status),
    start: () => undefined,
    stop: () => {
      seen.stops += 1;
      return Promise.resolve();
    },
  };
  return { seen, refresher };
}

async function appWith(refresher: Refresher) {
  // The routes in these tests never use the database.
  const db = {} as Parameters<typeof buildApp>[0]["db"];
  return buildApp({ config: testConfig, db, logger: false, refresher });
}

describe("GET /api/usage/status", () => {
  it("returns the state, the progress and the data as of time", async () => {
    const { refresher } = fakeRefresher();
    const app = await appWith(refresher);

    const response = await app.inject({ method: "GET", url: "/api/usage/status" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RUNNING);
  });
});

describe("POST /api/usage/refresh", () => {
  it("starts a refresh and returns the run with status 202", async () => {
    const { refresher, seen } = fakeRefresher();
    const app = await appWith(refresher);

    const response = await app.inject({ method: "POST", url: "/api/usage/refresh" });
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(RUNNING);
    expect(seen.triggers).toBe(1);
  });

  it("accepts an Origin that is in the allow-list", async () => {
    const { refresher, seen } = fakeRefresher();
    const app = await appWith(refresher);
    const origin = testConfig.CORS_ORIGINS[0] ?? "";

    const response = await app.inject({
      method: "POST",
      url: "/api/usage/refresh",
      headers: { origin },
    });
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(seen.triggers).toBe(1);
  });

  it("rejects an Origin that is not in the allow-list with 403 and starts no refresh", async () => {
    const { refresher, seen } = fakeRefresher();
    const app = await appWith(refresher);

    const response = await app.inject({
      method: "POST",
      url: "/api/usage/refresh",
      headers: { origin: "http://evil.example" },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(seen.triggers).toBe(0);
  });
});

describe("the refresher of the app", () => {
  it("stops when the app closes", async () => {
    const { refresher, seen } = fakeRefresher();
    const app = await appWith(refresher);

    await app.close();

    expect(seen.stops).toBe(1);
  });
});
