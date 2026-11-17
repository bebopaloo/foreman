import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ResolvedAdapter } from "./adapters.ts";

export const NO_TOKEN_STATE = "not connected: no token";
export const TOKEN_REFUSED_STATE = "token refused: not a fine-grained token";

const TOKEN_KEY = /^[a-z0-9.-]+\/[\w.-]+$/i;

const tokensFileSchema = z.record(z.string().regex(TOKEN_KEY), z.string().min(1));

/** The tokens of the tokens file, by lower case `<host>/<owner>`. Never log or serialise it. */
export type TokenStore = ReadonlyMap<string, string>;

export type TokenResolution =
  | { ok: true; token: string }
  | { ok: false; state: typeof NO_TOKEN_STATE | typeof TOKEN_REFUSED_STATE };

function tokenKey(host: string, owner: string): string {
  return `${host}/${owner}`.toLowerCase();
}

/** Validates a parsed JSON object of tokens. Gives `undefined` when the shape is wrong. */
export function parseTokens(json: unknown): TokenStore | undefined {
  const parsed = tokensFileSchema.safeParse(json);
  if (!parsed.success) return undefined;
  return new Map(Object.entries(parsed.data).map(([key, token]) => [key.toLowerCase(), token]));
}

/** Where the tokens come from: a file path, tokens that are already read, or nothing. */
export type TokenSource = string | TokenStore | undefined;

/**
 * Reads the tokens: a JSON object with one token for each `<host>/<owner>`.
 * A source that is a path to a missing or invalid file gives an empty store,
 * so every owner is "not connected".
 */
export async function readTokens(source: TokenSource): Promise<TokenStore> {
  if (source === undefined) return new Map();
  if (typeof source !== "string") return source;
  let text: string;
  try {
    text = await readFile(source, "utf8");
  } catch {
    return new Map();
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Map();
  }
  return parseTokens(json) ?? new Map();
}

/**
 * Gives the token of one host and owner to an adapter, only when the token starts
 * with the prefix that the adapter declares. The result never holds the prefix.
 */
export function resolveToken(
  tokens: TokenStore,
  host: string,
  owner: string,
  adapter: Pick<ResolvedAdapter, "tokenPrefix">,
): TokenResolution {
  const token = tokens.get(tokenKey(host, owner));
  if (token === undefined) return { ok: false, state: NO_TOKEN_STATE };
  if (!token.startsWith(adapter.tokenPrefix)) return { ok: false, state: TOKEN_REFUSED_STATE };
  return { ok: true, token };
}
