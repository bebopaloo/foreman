import { describe, expect, it } from "vitest";
import { parseAgentMeta, parseLine } from "./parse.ts";

function assistant(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    timestamp: "2026-11-01T10:00:00.000Z",
    cwd: "/synthetic/a/app",
    gitBranch: "main",
    message: {
      id: "msg_1",
      model: "claude-synthetic-1",
      content: [{ type: "text", text: "SECRET REPLY" }],
      usage: { input_tokens: 10, output_tokens: 20, ...usage },
    },
    ...overrides,
  });
}

describe("parseLine", () => {
  it("maps an assistant record to a turn with no text", () => {
    const result = parseLine(assistant());
    expect(result).toEqual({
      kind: "turn",
      turn: {
        turnKey: "msg_1",
        sessionId: "s1",
        time: new Date("2026-11-01T10:00:00.000Z"),
        model: "claude-synthetic-1",
        speed: null,
        serviceTier: null,
        inputTokens: 10,
        outputTokens: 20,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
        webSearchCount: 0,
        projectKey: "/synthetic/a/app",
        branch: "main",
      },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("splits cache writes by TTL, and counts an unsplit write as 5 minutes", () => {
    const split = parseLine(
      assistant(
        {},
        {
          cache_creation_input_tokens: 30,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
        },
      ),
    );
    expect(split).toMatchObject({ turn: { cacheWrite5mTokens: 10, cacheWrite1hTokens: 20 } });
    const unsplit = parseLine(assistant({}, { cache_creation_input_tokens: 30 }));
    expect(unsplit).toMatchObject({ turn: { cacheWrite5mTokens: 30, cacheWrite1hTokens: 0 } });
  });

  it("reads reads, web searches, speed and tier", () => {
    const result = parseLine(
      assistant(
        {},
        {
          cache_read_input_tokens: 5,
          server_tool_use: { web_search_requests: 2 },
          speed: "fast",
          service_tier: "batch",
        },
      ),
    );
    expect(result).toMatchObject({
      turn: { cacheReadTokens: 5, webSearchCount: 2, speed: "fast", serviceTier: "batch" },
    });
  });

  it("ignores user records and synthetic models", () => {
    expect(parseLine(JSON.stringify({ type: "user", message: { content: "hi" } }))).toEqual({
      kind: "ignore",
    });
    const synthetic = JSON.parse(assistant()) as { message: Record<string, unknown> };
    synthetic.message.model = "<synthetic>";
    expect(parseLine(JSON.stringify(synthetic))).toEqual({ kind: "ignore" });
  });

  it("ignores an assistant record with no usage", () => {
    const record = JSON.parse(assistant()) as { message: Record<string, unknown> };
    delete record.message.usage;
    expect(parseLine(JSON.stringify(record))).toEqual({ kind: "ignore" });
  });

  it("marks invalid JSON and a usage record with no message ID as malformed", () => {
    expect(parseLine("{not json")).toEqual({ kind: "malformed" });
    const record = JSON.parse(assistant()) as { message: Record<string, unknown> };
    delete record.message.id;
    expect(parseLine(JSON.stringify(record))).toEqual({ kind: "malformed" });
    expect(parseLine(assistant({ timestamp: "not a time" }))).toEqual({ kind: "malformed" });
  });
});

describe("parseAgentMeta", () => {
  it("reads the Agent type and the start tool call ID", () => {
    expect(parseAgentMeta(JSON.stringify({ agentType: "reviewer", toolUseId: "toolu_1" }))).toEqual(
      { agentType: "reviewer", startToolCallId: "toolu_1" },
    );
  });

  it("returns no fields for text that is not JSON", () => {
    expect(parseAgentMeta("not json")).toEqual({});
  });

  it("returns no fields when a field has the wrong type", () => {
    expect(parseAgentMeta(JSON.stringify({ agentType: 5, toolUseId: "toolu_1" }))).toEqual({});
  });

  it("returns no Agent type when it is empty", () => {
    expect(parseAgentMeta(JSON.stringify({ agentType: "" }))).toEqual({});
  });
});
