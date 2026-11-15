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

export interface ParsedUserMessage {
  recordId: string;
  sessionId: string;
  time: Date;
  projectKey: string;
  branch: string | null;
}

export type ParsedLine =
  | { kind: "turn"; turn: ParsedTurn }
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
    return {
      kind: "userMessage",
      userMessage: {
        recordId: user.data.uuid,
        sessionId: user.data.sessionId,
        time: new Date(user.data.timestamp),
        projectKey: user.data.cwd,
        branch: user.data.gitBranch ?? null,
      },
    };
  }
  if (!isAssistantWithUsage(record) || isSyntheticModel(record)) return { kind: "ignore" };
  const parsed = AssistantRecordSchema.safeParse(record);
  if (!parsed.success) return { kind: "malformed" };
  const { message } = parsed.data;
  const { usage } = message;
  const split = usage.cache_creation;
  return {
    kind: "turn",
    turn: {
      turnKey: message.id,
      sessionId: parsed.data.sessionId,
      time: new Date(parsed.data.timestamp),
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
