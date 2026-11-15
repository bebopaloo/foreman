import { schema } from "@foreman/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { subAgentSpansInWindow } from "../src/sessions/spans.ts";
import { openTestDatabase } from "./database.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate table turns`);
});

let counter = 0;

async function turn(
  time: string,
  agentId: string | null,
  over: { session?: string; project?: string } = {},
) {
  counter += 1;
  await database.db.insert(schema.turns).values({
    turnKey: `w${String(counter)}`,
    sessionId: over.session ?? "s1",
    time: new Date(time),
    model: "claude-synthetic-1",
    speed: null,
    serviceTier: null,
    inputTokens: 10,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearchCount: 0,
    projectKey: over.project ?? "/synthetic/acme/app",
    branch: null,
    worktreeName: null,
    agentType: agentId === null ? "main" : "review-finder",
    agentId,
    skillName: null,
    skillBasis: null,
  });
}

const window = { from: new Date("2026-11-14T10:00:00Z"), to: new Date("2026-11-14T11:00:00Z") };

describe("subAgentSpansInWindow", () => {
  it("returns the whole span of each sub-agent that has a turn in the window", async () => {
    await turn("2026-11-14T09:50:00Z", "a1");
    await turn("2026-11-14T10:30:00Z", "a1");
    await turn("2026-11-14T11:20:00Z", "a1");
    await turn("2026-11-14T09:00:00Z", "a2");
    await turn("2026-11-14T10:10:00Z", null);

    const spans = await subAgentSpansInWindow(database.db, { ...window, clientKeys: null });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      key: "a:a1",
      kind: "sub-agent",
      turns: 3,
      tokens: 30,
      start: new Date("2026-11-14T09:50:00Z"),
      end: new Date("2026-11-14T11:20:00Z"),
    });
  });

  it("does not join two sessions that reuse an agent ID", async () => {
    await turn("2026-11-14T10:10:00Z", "a1", { session: "s1" });
    await turn("2026-11-14T12:10:00Z", "a1", { session: "s2" });

    const spans = await subAgentSpansInWindow(database.db, { ...window, clientKeys: null });

    expect(spans.map((span) => [span.sessionId, span.turns])).toEqual([["s1", 1]]);
  });

  it("uses only the turns of the client scope", async () => {
    await turn("2026-11-14T10:10:00Z", "a1");
    await turn("2026-11-14T10:20:00Z", "b1", { project: "/synthetic/other/app" });

    const spans = await subAgentSpansInWindow(database.db, {
      ...window,
      clientKeys: ["/synthetic/other/app"],
    });

    expect(spans.map((span) => span.key)).toEqual(["a:b1"]);
  });

  it("returns nothing for an empty window", async () => {
    expect(await subAgentSpansInWindow(database.db, { ...window, clientKeys: null })).toEqual([]);
  });
});
