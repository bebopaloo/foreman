import { describe, expect, it } from "vitest";
import { type AttributionSession, attributeSession, isBuiltInCommand } from "./skills.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 10, minute));

function session(overrides: Partial<AttributionSession>): AttributionSession {
  return { turns: [], calls: [], starts: [], agents: [], userMessageTimes: [], ...overrides };
}

const mainTurn = (key: string, minute: number) => ({
  turnKey: key,
  time: at(minute),
  agentId: null,
});

describe("isBuiltInCommand", () => {
  it("knows the commands of Claude Code and not a skill name", () => {
    expect(isBuiltInCommand("compact")).toBe(true);
    expect(isBuiltInCommand("clear")).toBe(true);
    expect(isBuiltInCommand("factory-core:to-code")).toBe(false);
  });
});

describe("attributeSession", () => {
  const call = (callId: string, minute: number, skillName: string, messageId: string | null) => ({
    callId,
    agentId: null,
    messageId,
    time: at(minute),
    skillName,
  });

  it("gives no skill to a turn before the first call", () => {
    const result = attributeSession(
      session({ turns: [mainTurn("t0", 0)], calls: [call("c1", 5, "a", "m1")] }),
    );
    expect(result.size).toBe(0);
  });

  it("starts a new span at a later skill call", () => {
    const result = attributeSession(
      session({
        turns: [mainTurn("t1", 6), mainTurn("t2", 11)],
        calls: [call("c1", 5, "a", "m1"), call("c2", 10, "b", "m2")],
      }),
    );
    expect(result.get("t1")).toEqual({ skill: "a", basis: "estimate" });
    expect(result.get("t2")).toEqual({ skill: "b", basis: "estimate" });
  });

  it("ends a span at a real user message", () => {
    const result = attributeSession(
      session({
        turns: [mainTurn("t1", 6), mainTurn("t2", 9)],
        calls: [call("c1", 5, "a", "m1")],
        userMessageTimes: [at(5), at(8)],
      }),
    );
    expect(result.get("t1")?.skill).toBe("a");
    expect(result.has("t2")).toBe(false);
  });

  it("calls a span ambiguous when one message calls two skills", () => {
    const result = attributeSession(
      session({
        turns: [mainTurn("t1", 6)],
        calls: [call("c1", 5, "a", "m1"), call("c2", 5, "b", "m1")],
      }),
    );
    expect(result.get("t1")).toEqual({ skill: "(ambiguous)", basis: "estimate" });
  });

  it("treats two calls of the same skill in one message as one skill", () => {
    const result = attributeSession(
      session({
        turns: [mainTurn("t1", 6)],
        calls: [call("c1", 5, "a", "m1"), call("c2", 5, "a", "m1")],
      }),
    );
    expect(result.get("t1")).toEqual({ skill: "a", basis: "estimate" });
  });

  it("gives a sub-agent started by a skill call exact turns", () => {
    const result = attributeSession(
      session({
        turns: [{ turnKey: "s1", time: at(7), agentId: "a1" }],
        calls: [call("c1", 5, "a", "m1")],
        agents: [{ agentId: "a1", startToolCallId: "c1" }],
      }),
    );
    expect(result.get("s1")).toEqual({ skill: "a", basis: "exact" });
  });

  it("follows an agent start through a span and through a parent sub-agent", () => {
    const result = attributeSession(
      session({
        turns: [
          { turnKey: "s1", time: at(7), agentId: "a1" },
          { turnKey: "s2", time: at(8), agentId: "a2" },
        ],
        calls: [call("c1", 5, "a", "m1")],
        starts: [
          { callId: "g1", agentId: null, time: at(6) },
          { callId: "g2", agentId: "a1", time: at(7) },
        ],
        agents: [
          { agentId: "a1", startToolCallId: "g1" },
          { agentId: "a2", startToolCallId: "g2" },
        ],
      }),
    );
    expect(result.get("s1")).toEqual({ skill: "a", basis: "exact" });
    expect(result.get("s2")).toEqual({ skill: "a", basis: "exact" });
  });

  it("gives no skill to a sub-agent with an unknown start, a start outside a span, or a loop", () => {
    const result = attributeSession(
      session({
        turns: [
          { turnKey: "s1", time: at(7), agentId: "a1" },
          { turnKey: "s2", time: at(7), agentId: "a2" },
          { turnKey: "s3", time: at(7), agentId: "a3" },
          { turnKey: "s4", time: at(7), agentId: "a4" },
        ],
        starts: [
          { callId: "g1", agentId: null, time: at(1) },
          { callId: "g3", agentId: "a4", time: at(2) },
          { callId: "g4", agentId: "a3", time: at(2) },
        ],
        agents: [
          { agentId: "a1", startToolCallId: null },
          { agentId: "a2", startToolCallId: "g1" },
          { agentId: "a3", startToolCallId: "g3" },
          { agentId: "a4", startToolCallId: "g4" },
        ],
      }),
    );
    expect(result.size).toBe(0);
  });

  it("marks the turns of a sub-agent in an ambiguous span as an estimate", () => {
    const result = attributeSession(
      session({
        turns: [{ turnKey: "s1", time: at(7), agentId: "a1" }],
        calls: [call("c1", 5, "a", "m1"), call("c2", 5, "b", "m1")],
        starts: [{ callId: "g1", agentId: null, time: at(6) }],
        agents: [{ agentId: "a1", startToolCallId: "g1" }],
      }),
    );
    expect(result.get("s1")).toEqual({ skill: "(ambiguous)", basis: "estimate" });
  });

  it("ignores a skill call inside a sub-agent when it builds spans", () => {
    const result = attributeSession(
      session({
        turns: [mainTurn("t1", 6)],
        calls: [{ callId: "c1", agentId: "a1", messageId: "m1", time: at(5), skillName: "a" }],
      }),
    );
    expect(result.size).toBe(0);
  });
});
