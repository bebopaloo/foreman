import { describe, expect, it } from "vitest";
import { compareSemVer, parseSemVer } from "./semver.ts";

function compare(a: string, b: string): number {
  const left = parseSemVer(a);
  const right = parseSemVer(b);
  if (left === undefined || right === undefined) throw new Error("not SemVer");
  return Math.sign(compareSemVer(left, right));
}

describe("parseSemVer", () => {
  it.each(["0.37.5", "1.0.0-alpha.1", "1.0.0+build.5", "10.20.30-rc.1+x"])("accepts %s", (v) => {
    expect(parseSemVer(v)).toBeDefined();
  });

  it.each(["abc1234", "1.2", "01.2.3", "1.2.3-", "v1.2.3", ""])("refuses %s", (v) => {
    expect(parseSemVer(v)).toBeUndefined();
  });
});

describe("compareSemVer", () => {
  it("compares numbers, not text", () => {
    expect(compare("0.10.0", "0.9.0")).toBe(1);
    expect(compare("0.37.5", "0.30.0")).toBe(1);
    expect(compare("1.0.0", "1.0.0")).toBe(0);
  });

  it("puts a prerelease below its release and orders identifiers by the SemVer rules", () => {
    expect(compare("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compare("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compare("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compare("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compare("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
    expect(compare("1.0.0-rc.1", "1.0.0-beta.11")).toBe(1);
  });

  it("ignores build metadata", () => {
    expect(compare("1.0.0+a", "1.0.0+b")).toBe(0);
  });
});
