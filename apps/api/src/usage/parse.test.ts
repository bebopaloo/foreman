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

function user(overrides: Record<string, unknown> = {}, content: unknown = "SECRET PROMPT") {
  return JSON.stringify({
    type: "user",
    uuid: "u1",
    sessionId: "s1",
    timestamp: "2026-11-01T10:00:00.000Z",
    cwd: "/synthetic/a/app",
    gitBranch: "main",
    message: { role: "user", content },
    ...overrides,
  });
}

describe("parseLine user messages", () => {
  it("maps a real user message to a time with no text", () => {
    const result = parseLine(user());
    expect(result).toEqual({
      kind: "userMessage",
      userMessage: {
        recordId: "u1",
        sessionId: "s1",
        time: new Date("2026-11-01T10:00:00.000Z"),
        projectKey: "/synthetic/a/app",
        branch: "main",
      },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("counts a message with text blocks, and a message with text next to a tool result", () => {
    const blocks = [
      { type: "tool_result", tool_use_id: "t1", content: "x" },
      { type: "text", text: "SECRET" },
    ];
    expect(parseLine(user({}, blocks)).kind).toBe("userMessage");
    expect(parseLine(user({}, [{ type: "text", text: "SECRET" }])).kind).toBe("userMessage");
  });

  it("ignores a user message that has only tool results, or that is meta", () => {
    expect(parseLine(user({}, [{ type: "tool_result", tool_use_id: "t1", content: "x" }]))).toEqual(
      { kind: "ignore" },
    );
    expect(parseLine(user({ isMeta: true }))).toEqual({ kind: "ignore" });
  });

  it("reports a real user message that has no record ID as malformed", () => {
    expect(parseLine(user({ uuid: undefined }))).toEqual({ kind: "malformed" });
  });
});

describe("parseLine", () => {
  it("maps an assistant record to a turn with no text", () => {
    const result = parseLine(assistant());
    expect(result).toEqual({
      kind: "turn",
      skillCalls: [],
      agentStarts: [],
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

  it("ignores user records that are not real messages, and synthetic models", () => {
    expect(
      parseLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } })),
    ).toEqual({ kind: "ignore" });
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

describe("parseLine skill calls and agent starts", () => {
  const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
    type: "tool_use",
    id,
    name,
    input,
  });

  function turnOf(content: unknown[]) {
    const result = parseLine(
      assistant({}, {}).replace(/"content":\[[^\]]*\]/, `"content":${JSON.stringify(content)}`),
    );
    if (result.kind !== "turn") throw new Error("not a turn");
    return result;
  }

  it("keeps the call ID and the skill name of a Skill call, and nothing else of its input", () => {
    const result = turnOf([
      toolUse("t1", "Skill", { skill: "/factory-core:to-code", args: "SECRET" }),
    ]);
    expect(result.skillCalls).toEqual([
      {
        callId: "t1",
        sessionId: "s1",
        messageId: "msg_1",
        time: new Date("2026-11-01T10:00:00.000Z"),
        skillName: "factory-core:to-code",
        projectKey: "/synthetic/a/app",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("keeps the call ID of an Agent call and of a Task call", () => {
    const result = turnOf([
      toolUse("t1", "Agent", { prompt: "SECRET" }),
      toolUse("t2", "Task", { prompt: "SECRET" }),
      toolUse("t3", "Bash", { command: "SECRET" }),
      toolUse("t4", "Skill", {}),
    ]);
    expect(result.agentStarts.map((start) => start.callId)).toEqual(["t1", "t2"]);
    expect(result.skillCalls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reads the name of a slash command and keeps no text", () => {
    const command =
      "<command-message>x</command-message>\n<command-name>/review-spec</command-name>\n<command-args>SECRET</command-args>";
    const result = parseLine(user({}, command));
    expect(result).toMatchObject({ userMessage: { command: "review-spec" } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    const blocks = parseLine(user({}, [{ type: "text", text: command }, { type: "image" }]));
    expect(blocks).toMatchObject({ userMessage: { command: "review-spec" } });
  });

  it("reads no command from a prompt that only mentions the tag", () => {
    const result = parseLine(user({}, "please explain <command-name>/x</command-name>"));
    expect(result).toMatchObject({ kind: "userMessage" });
    expect(JSON.stringify(result)).not.toContain("command");
  });
});
