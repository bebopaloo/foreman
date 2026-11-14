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

export type ParsedLine =
  { kind: "turn"; turn: ParsedTurn } | { kind: "ignore" } | { kind: "malformed" };

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

/** Maps one transcript line to a turn, to nothing, or to a malformed line. */
export function parseLine(line: string): ParsedLine {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
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
