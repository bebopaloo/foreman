import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const DATABASE_URL = "postgres://app@127.0.0.1:55432/app";

describe("loadConfig", () => {
  it("uses safe defaults for a local run", () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.PORT).toBe(47_130);
  });

  it("allows the dev web origin by default", () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.CORS_ORIGINS).toEqual(["http://127.0.0.1:47173"]);
  });

  it("splits the CORS allow-list", () => {
    const config = loadConfig({
      DATABASE_URL,
      CORS_ORIGINS: "https://a.example, https://b.example",
    });
    expect(config.CORS_ORIGINS).toEqual(["https://a.example", "https://b.example"]);
  });

  it("fails fast without a database URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("names the variable but never echoes its value", () => {
    const secret = "not-a-url-but-a-secret";
    expect(() => loadConfig({ DATABASE_URL: secret })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: secret })).not.toThrow(new RegExp(secret));
  });

  it("rejects a port out of range", () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: "70000" })).toThrow(/PORT/);
  });
});
