import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { isTokenKey, loggerOptions, redactTokens } from "./log.ts";

describe("isTokenKey", () => {
  it.each(["token", "Token", "access_token", "GITHUB_TOKEN"])("matches %s", (key) => {
    expect(isTokenKey(key)).toBe(true);
  });
  it.each(["tokens", "tokenizer", "token_count", "input_tokens"])("does not match %s", (key) => {
    expect(isTokenKey(key)).toBe(false);
  });
});

describe("redactTokens", () => {
  it("replaces token keys at any depth, in arrays too, and keeps the other keys", () => {
    const input = {
      token: "a",
      repo: "r",
      nested: { api_token: "b", list: [{ token: "c", n: 1 }] },
    };
    expect(redactTokens(input)).toEqual({
      token: "[Redacted]",
      repo: "r",
      nested: { api_token: "[Redacted]", list: [{ token: "[Redacted]", n: 1 }] },
    });
  });

  it("does not change its input", () => {
    const input = { token: "a" };
    redactTokens(input);
    expect(input.token).toBe("a");
  });

  it("leaves an Error alone", () => {
    const error = new Error("x");
    expect(redactTokens({ err: error })).toEqual({ err: error });
  });
});

describe("loggerOptions", () => {
  it("writes no token value into a log line", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString("utf8"));
        callback();
      },
    });
    const app = Fastify({ logger: { ...loggerOptions("info"), stream } });
    app.log.info({ token: "secret-1", deep: { github_token: "secret-2" }, calls: 3 }, "fetch");
    await app.close();
    const text = lines.join("");
    expect(text).not.toContain("secret-1");
    expect(text).not.toContain("secret-2");
    expect(text).toContain('"calls":3');
  });
});
