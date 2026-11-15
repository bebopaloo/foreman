import { z } from "zod";

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().int().nonnegative().default(0),
      ephemeral_1h_input_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
  server_tool_use: z
    .object({ web_search_requests: z.number().int().nonnegative().default(0) })
    .optional(),
  speed: z.string().nullish(),
  service_tier: z.string().nullish(),
});

// Only the fields that Foreman uses. The schema drops all other fields, so
// no prompt, reply, tool input or tool output can reach the index.
const ToolUseSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string(),
  input: z.object({ skill: z.string().min(1).optional() }).optional(),
});

const SKILL_TOOL = "Skill";
// The tool that starts a sub-agent is "Agent" in a current transcript and "Task" in an older one.
const AGENT_TOOLS: readonly string[] = ["Agent", "Task"];

const AssistantRecordSchema = z.object({
  type: z.literal("assistant"),
  sessionId: z.string().min(1),
  timestamp: z.iso.datetime(),
  cwd: z.string().min(1),
  gitBranch: z.string().nullish(),
  message: z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    usage: UsageSchema,
    content: z.array(z.unknown()).optional(),
  }),
});

export interface ParsedTurn {
  turnKey: string;
  sessionId: string;
  time: Date;
  model: string;
  speed: string | null;
  serviceTier: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  webSearchCount: number;
  projectKey: string;
  branch: string | null;
}

export interface ParsedSkillCall {
  callId: string;
  sessionId: string;
  /** The ID of the assistant message that made the call, or null for a slash command. */
  messageId: string | null;
  time: Date;
  skillName: string;
  projectKey: string;
}

export interface ParsedAgentStart {
  callId: string;
  sessionId: string;
  time: Date;
}

export interface ParsedUserMessage {
  recordId: string;
  sessionId: string;
  time: Date;
  projectKey: string;
  branch: string | null;
  /** The name of a slash command in the message, with no leading "/". */
  command?: string;
}

export type ParsedLine =
  | {
      kind: "turn";
      turn: ParsedTurn;
      skillCalls: ParsedSkillCall[];
      agentStarts: ParsedAgentStart[];
    }
  | { kind: "userMessage"; userMessage: ParsedUserMessage }
  | { kind: "ignore" }
  | { kind: "malformed" };

// The schema has no field for the message content, so no prompt can reach the index.
const UserRecordSchema = z.object({
  type: z.literal("user"),
  uuid: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: z.iso.datetime(),
  cwd: z.string().min(1),
  gitBranch: z.string().nullish(),
});

const COMMAND_PATTERN =
  /^\s*(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\s*\/?([A-Za-z0-9][A-Za-z0-9:_.-]*)\s*<\/command-name>/;

/** The slash command name of a user record, or undefined. The text itself never leaves this function. */
function commandName(record: unknown): string | undefined {
  if (typeof record !== "object" || record === null || !("message" in record)) return undefined;
  const message = record.message;
  if (typeof message !== "object" || message === null || !("content" in message)) return undefined;
  const { content } = message;
  const texts: unknown[] = Array.isArray(content) ? content.map(blockText) : [content];
  for (const text of texts) {
    if (typeof text !== "string") continue;
    const match = COMMAND_PATTERN.exec(text);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function blockText(block: unknown): unknown {
  return typeof block === "object" && block !== null && "text" in block ? block.text : undefined;
}

function isRealUserRecord(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  if (!("type" in record) || record.type !== "user") return false;
  if ("isMeta" in record && record.isMeta === true) return false;
  if (!("message" in record) || typeof record.message !== "object" || record.message === null) {
    return false;
  }
  const content = "content" in record.message ? record.message.content : undefined;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block: unknown) =>
      !(
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "tool_result"
      ),
  );
}

const SYNTHETIC_MODEL = "<synthetic>";

function isAssistantWithUsage(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  if (!("type" in record) || record.type !== "assistant") return false;
  if (!("message" in record) || typeof record.message !== "object" || record.message === null) {
    return false;
  }
  return "usage" in record.message && typeof record.message.usage === "object";
}

function isSyntheticModel(record: unknown): boolean {
  if (typeof record !== "object" || record === null || !("message" in record)) return false;
  const message = record.message;
  return (
    typeof message === "object" &&
    message !== null &&
    "model" in message &&
    message.model === SYNTHETIC_MODEL
  );
}

/** Maps one transcript line to a turn, a real user message, to nothing, or to a malformed line. */
export function parseLine(line: string): ParsedLine {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
  }
  if (isRealUserRecord(record)) {
    const user = UserRecordSchema.safeParse(record);
    if (!user.success) return { kind: "malformed" };
    const command = commandName(record);
    return {
      kind: "userMessage",
      userMessage: {
        recordId: user.data.uuid,
        sessionId: user.data.sessionId,
        time: new Date(user.data.timestamp),
        projectKey: user.data.cwd,
        branch: user.data.gitBranch ?? null,
        ...(command === undefined ? {} : { command }),
      },
    };
  }
  if (!isAssistantWithUsage(record) || isSyntheticModel(record)) return { kind: "ignore" };
  const parsed = AssistantRecordSchema.safeParse(record);
  if (!parsed.success) return { kind: "malformed" };
  const { message } = parsed.data;
  const { usage } = message;
  const split = usage.cache_creation;
  const time = new Date(parsed.data.timestamp);
  const skillCalls: ParsedSkillCall[] = [];
  const agentStarts: ParsedAgentStart[] = [];
  for (const block of message.content ?? []) {
    const toolUse = ToolUseSchema.safeParse(block);
    if (!toolUse.success) continue;
    const { id, name, input } = toolUse.data;
    if (name === SKILL_TOOL && input?.skill !== undefined) {
      skillCalls.push({
        callId: id,
        sessionId: parsed.data.sessionId,
        messageId: message.id,
        time,
        skillName: input.skill.replace(/^\//, ""),
        projectKey: parsed.data.cwd,
      });
    } else if (AGENT_TOOLS.includes(name)) {
      agentStarts.push({ callId: id, sessionId: parsed.data.sessionId, time });
    }
  }
  return {
    kind: "turn",
    skillCalls,
    agentStarts,
    turn: {
      turnKey: message.id,
      sessionId: parsed.data.sessionId,
      time,
      model: message.model,
      speed: usage.speed ?? null,
      serviceTier: usage.service_tier ?? null,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheWrite5mTokens: split
        ? split.ephemeral_5m_input_tokens
        : usage.cache_creation_input_tokens,
      cacheWrite1hTokens: split ? split.ephemeral_1h_input_tokens : 0,
      cacheReadTokens: usage.cache_read_input_tokens,
      webSearchCount: usage.server_tool_use?.web_search_requests ?? 0,
      projectKey: parsed.data.cwd,
      branch: parsed.data.gitBranch ?? null,
    },
  };
}

// Only the two fields that Foreman uses. The schema drops the task description and all other fields.
const AgentMetaSchema = z.object({
  agentType: z.string().min(1).optional(),
  toolUseId: z.string().min(1).optional(),
});

export interface AgentMeta {
  agentType?: string;
  startToolCallId?: string;
}

/** Reads the Agent type and the start tool call ID from the text of a meta file. */
export function parseAgentMeta(text: string): AgentMeta {
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return {};
  }
  const parsed = AgentMetaSchema.safeParse(record);
  if (!parsed.success) return {};
  const { agentType, toolUseId } = parsed.data;
  return {
    ...(agentType === undefined ? {} : { agentType }),
    ...(toolUseId === undefined ? {} : { startToolCallId: toolUseId }),
  };
}
