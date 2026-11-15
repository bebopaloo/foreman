import type { FastifyServerOptions } from "fastify";

const REDACTED = "[Redacted]";
const MAX_DEPTH = 8;

/** Matches `token` and every key that ends in `_token`, in any letter case. */
export function isTokenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "token" || lower.endsWith("_token");
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copies a log object and replaces the value of each token key at any depth.
 * A Pino `redact` path cannot match a key suffix, so the logger formatter does it.
 */
export function redactTokens(value: unknown, depth = 0): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item): unknown => redactTokens(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = isTokenKey(key) ? REDACTED : redactTokens(item, depth + 1);
  }
  return copy;
}

const REDACTED_PATHS = ["req.headers.authorization", "req.headers.cookie", "*.password"];

type LoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

/** The Pino options of the app: the redaction paths and the token-key formatter. */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: REDACTED_PATHS,
    formatters: {
      log: (object) => {
        const redacted = redactTokens(object);
        return typeof redacted === "object" && redacted !== null ? { ...redacted } : object;
      },
    },
  };
}
