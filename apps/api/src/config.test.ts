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

  it("reads the tokens file from the Compose secret by default and from a variable", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_TOKENS_FILE).toBe("/run/secrets/foreman_tokens");
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_TOKENS_FILE: "/synthetic/tokens.json" })
        .FOREMAN_TOKENS_FILE,
    ).toBe("/synthetic/tokens.json");
  });

  it("has no Marketplace folder by default and reads an absolute one", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_MARKETPLACE_DIR).toBeUndefined();
    expect(loadConfig({ DATABASE_URL, FOREMAN_MARKETPLACE_DIR: "" }).FOREMAN_MARKETPLACE_DIR).toBe(
      undefined,
    );
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_MARKETPLACE_DIR: "/synthetic/factory" })
        .FOREMAN_MARKETPLACE_DIR,
    ).toBe("/synthetic/factory");
  });

  it("stops for a Marketplace folder that is not an absolute path", () => {
    expect(() => loadConfig({ DATABASE_URL, FOREMAN_MARKETPLACE_DIR: "factory" })).toThrow(
      "FOREMAN_MARKETPLACE_DIR",
    );
    expect(() => loadConfig({ DATABASE_URL, FOREMAN_MARKETPLACE_DIR: "~/factory" })).toThrow(
      "FOREMAN_MARKETPLACE_DIR",
    );
  });

  it("reads the price table of the repo by default and from a variable", () => {
    expect(loadConfig({ DATABASE_URL }).FOREMAN_PRICE_TABLE).toMatch(/data\/price-table\.json$/);
    expect(
      loadConfig({ DATABASE_URL, FOREMAN_PRICE_TABLE: "/synthetic/prices.json" })
        .FOREMAN_PRICE_TABLE,
    ).toBe("/synthetic/prices.json");
  });

  it("uses the ledger defaults and reads the ledger variables", () => {
    const defaults = loadConfig({ DATABASE_URL });
    expect(defaults.FOREMAN_LEDGER_TIME_ZONE).toBe("Europe/London");
    expect(defaults.FOREMAN_LEDGER_IDLE_MINUTES).toBe(15);
    expect(defaults.FOREMAN_LEDGER_LEAD_IN_MINUTES).toBe(2);
    const set = loadConfig({
      DATABASE_URL,
      FOREMAN_LEDGER_TIME_ZONE: "Asia/Tokyo",
      FOREMAN_LEDGER_IDLE_MINUTES: "45",
      FOREMAN_LEDGER_LEAD_IN_MINUTES: "0",
    });
    expect(set.FOREMAN_LEDGER_TIME_ZONE).toBe("Asia/Tokyo");
    expect(set.FOREMAN_LEDGER_IDLE_MINUTES).toBe(45);
    expect(set.FOREMAN_LEDGER_LEAD_IN_MINUTES).toBe(0);
  });

  it("names the ledger variable that is not valid", () => {
    const bad = (env: Record<string, string>) => () => loadConfig({ DATABASE_URL, ...env });
    expect(bad({ FOREMAN_LEDGER_TIME_ZONE: "Mars/Base" })).toThrow(/FOREMAN_LEDGER_TIME_ZONE/);
    expect(bad({ FOREMAN_LEDGER_IDLE_MINUTES: "0" })).toThrow(/FOREMAN_LEDGER_IDLE_MINUTES/);
    expect(bad({ FOREMAN_LEDGER_IDLE_MINUTES: "121" })).toThrow(/FOREMAN_LEDGER_IDLE_MINUTES/);
    expect(bad({ FOREMAN_LEDGER_IDLE_MINUTES: "1.5" })).toThrow(/FOREMAN_LEDGER_IDLE_MINUTES/);
    expect(bad({ FOREMAN_LEDGER_LEAD_IN_MINUTES: "-1" })).toThrow(/FOREMAN_LEDGER_LEAD_IN_MINUTES/);
    expect(bad({ FOREMAN_LEDGER_LEAD_IN_MINUTES: "20" })).toThrow(/FOREMAN_LEDGER_LEAD_IN_MINUTES/);
    expect(
      bad({ FOREMAN_LEDGER_IDLE_MINUTES: "30", FOREMAN_LEDGER_LEAD_IN_MINUTES: "20" }),
    ).not.toThrow();
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
