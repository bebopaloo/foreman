/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const tokensCss = readFileSync("src/theme/tokens.css", "utf8");

type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
  const tokens: Tokens = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) tokens[name] = value;
  }
  return tokens;
}

function blockOf(selector: string): Tokens {
  const start = tokensCss.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return declarations(tokensCss.slice(start, tokensCss.indexOf("}", start)));
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Each pair is text on its background.
const PAIRS: [string, string][] = [
  ["ink", "page"],
  ["ink", "surface"],
  ["ink", "surface-hover"],
  ["muted", "page"],
  ["muted", "surface"],
  ["accent", "surface"],
  ["accent", "page"],
  ["accent-ink", "accent"],
  ["all-ink", "all-bg"],
  ["warn-ink", "warn-bg"],
  ["ok", "surface"],
  ["ok", "page"],
  ["warn", "surface"],
  ["warn", "page"],
  ["danger", "surface"],
  ["danger", "page"],
];

// Each Agent type bar sits on the lane of the timeline, which has the colour of `surface-hover`.
const AGENT_BARS = [
  "agent-main",
  "agent-software-developer",
  "agent-review-finder",
  "agent-review-verifier",
  "agent-review-resolver",
  "agent-other",
];

describe("the colour tokens", () => {
  const light = blockOf(":root {");
  const dark = { ...light, ...blockOf(':root[data-theme="dark"]') };

  it("give the dark theme a value for every light token", () => {
    const darkOnly = blockOf(':root[data-theme="dark"]');
    expect(Object.keys(darkOnly).sort()).toEqual(Object.keys(light).sort());
  });

  describe.each([
    ["light", light],
    ["dark", dark],
  ])("in the %s theme", (_name, tokens) => {
    it.each(PAIRS)("%s on %s passes 4.5:1", (foreground, background) => {
      const fg = tokens[foreground];
      const bg = tokens[background];
      expect(fg).toBeDefined();
      expect(bg).toBeDefined();
      expect(contrast(fg ?? "", bg ?? "")).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe.each([
    ["light", light],
    ["dark", dark],
  ])("for the Agent type bars in the %s theme", (_name, tokens) => {
    it.each(AGENT_BARS)("%s on the lane passes 3:1", (bar) => {
      const fg = tokens[bar];
      const bg = tokens["surface-hover"];
      expect(fg).toBeDefined();
      expect(bg).toBeDefined();
      expect(contrast(fg ?? "", bg ?? "")).toBeGreaterThanOrEqual(3);
    });

    it("gives each Agent type bar its own colour", () => {
      const values = AGENT_BARS.map((bar) => tokens[bar]);
      expect(new Set(values).size).toBe(AGENT_BARS.length);
    });
  });
});
