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

  it("allows only github.com and a 60 second adapter timeout by default", () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.FOREMAN_ALLOWED_HOSTS).toEqual(["github.com"]);
    expect(config.FOREMAN_ADAPTER_TIMEOUT_SECONDS).toBe(60);
  });

  it("splits the host allow-list and reads the adapter timeout", () => {
    const config = loadConfig({
      DATABASE_URL,
      FOREMAN_ALLOWED_HOSTS: "GitHub.com, git.example.com",
      FOREMAN_ADAPTER_TIMEOUT_SECONDS: "30",
    });
    expect(config.FOREMAN_ALLOWED_HOSTS).toEqual(["github.com", "git.example.com"]);
    expect(config.FOREMAN_ADAPTER_TIMEOUT_SECONDS).toBe(30);
  });

  it("refreshes the usage each 15 minutes by default and reads 1 to 1,440 minutes", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_USAGE_REFRESH_MINUTES).toBe(15);
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_USAGE_REFRESH_MINUTES: "1" })
        .FOREMAN_USAGE_REFRESH_MINUTES,
    ).toBe(1);
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_USAGE_REFRESH_MINUTES: "1440" })
        .FOREMAN_USAGE_REFRESH_MINUTES,
    ).toBe(1440);
  });

  it.each(["0", "1441", "1.5", "abc"])("rejects %s as the usage refresh minutes", (value) => {
    expect(() => loadConfig({ DATABASE_URL, FOREMAN_USAGE_REFRESH_MINUTES: value })).toThrow(
      "FOREMAN_USAGE_REFRESH_MINUTES",
    );
  });

  it("reads the tokens file from the Compose secret by default and from a variable", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_TOKENS_FILE).toBe("/run/secrets/foreman_tokens");
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_TOKENS_FILE: "/synthetic/tokens.json" })
        .FOREMAN_TOKENS_FILE,
    ).toBe("/synthetic/tokens.json");
  });

  it("reads the price table of the repo by default and from a variable", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_PRICE_TABLE).toMatch(/data\/price-table\.json$/);
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_PRICE_TABLE: "/synthetic/prices.json" })
        .FOREMAN_PRICE_TABLE,
    ).toBe("/synthetic/prices.json");
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

describe("loadConfig config folder", () => {
  const HOME = "/home/synthetic";

  it("reads from ~/.claude-bebopaloo with no variable", () => {
    const config = loadConfig({ DATABASE_URL }, HOME);
    expect(config.FOREMAN_CLAUDE_DIR).toBe("/home/synthetic/.claude-bebopaloo");
    expect(config.FOREMAN_DATA_DIR).toBe("/home/synthetic/.foreman");
  });

  it("uses the folder that the variable names", () => {
    const config = loadConfig({ DATABASE_URL, FOREMAN_CLAUDE_DIR: "/srv/claude" }, HOME);
    expect(config.FOREMAN_CLAUDE_DIR).toBe("/srv/claude");
  });

  it("stops when the variable points to ~/.claude", () => {
    expect(() => loadConfig({ DATABASE_URL, FOREMAN_CLAUDE_DIR: "~/.claude" }, HOME)).toThrow(
      /FOREMAN_CLAUDE_DIR/,
    );
    expect(() =>
      loadConfig({ DATABASE_URL, FOREMAN_CLAUDE_DIR: "/home/synthetic/.claude/" }, HOME),
    ).toThrow(/FOREMAN_CLAUDE_DIR/);
  });
});
