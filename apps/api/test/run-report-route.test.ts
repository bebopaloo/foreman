import { RunReportResponse } from "@foreman/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { makeFactoryDir, nightLine, NOW, writeJsonl } from "./dash-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function get(url: string, lines: Record<string, unknown>[]) {
  const { claudeDir, factory } = await makeFactoryDir();
  await writeJsonl(factory, "runs", "2026-11-15", lines);
  const app = await buildApp({
    config: { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir },
    db: database.db,
    logger: { level: "silent" },
    now: () => NOW,
  });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return response;
}

describe("GET /api/runs/:runId/report", () => {
  it("returns the report of one run", async () => {
    const response = await get("/api/runs/run-1/report", [
      nightLine({ time: "2026-11-15T10:00:00Z" }),
      nightLine({
        from: "IN PROGRESS",
        to: "DONE",
        reason: "merged #3",
        time: "2026-11-15T10:04:00Z",
      }),
    ]);
    expect(response.statusCode).toBe(200);
    const body = RunReportResponse.parse(response.json());
    expect(body.runId).toBe("run-1");
    expect(body.slotUse.minutesAtCount).toHaveLength(6);
    expect(body.merges).toHaveLength(1);
  });

  it("answers 404 for a run with no line", async () => {
    const response = await get("/api/runs/run-9/report", [nightLine()]);
    expect(response.statusCode).toBe(404);
  });

  it("refuses a run ID with odd characters", async () => {
    const response = await get("/api/runs/run%2E%2E%20x/report", [nightLine()]);
    expect(response.statusCode).toBe(400);
  });
});
