import { describe, expect, it } from "vitest";
import { parseRepoConfig } from "./files.ts";
import { fileBranchFor, filesToRead, usableDefaultBranch } from "./modules.ts";

const REGULATED = [
  "risk_tiers",
  "security_criteria",
  "scanners",
  "security_section",
  "dependency_control",
  "waivers",
  "finding_lifecycle",
  "control_register",
  "threat_model",
  "release_approval",
  "traceability",
  "release_record",
  "control_events",
];

function parse(config: unknown) {
  const result = parseRepoConfig(JSON.stringify(config));
  if (!result.ok) throw new Error("the config was not readable");
  return result.fields;
}

describe("the repo config parser", () => {
  it("reads the profile and the module names of a controls key", () => {
    const fields = parse({ controls: { profile: "regulated", modules: REGULATED, settings: {} } });
    expect(fields.controls).toEqual({ state: "ok", profile: "regulated", modules: REGULATED });
  });

  it("gives the profile none and no module for a config with no controls key", () => {
    expect(parse({ main_branch: "main" }).controls).toEqual({ state: "none" });
  });

  it("ignores keys that it does not read, at the top and in no other place", () => {
    const fields = parse({
      unknown_key: { deep: true },
      stack_pack: "stack-ts",
      main_branch: "develop",
    });
    expect(fields).toEqual({
      mainBranch: "develop",
      controls: { state: "none" },
      releases: null,
    });
  });

  it.each([
    ["modules is a text", { profile: "standard", modules: "risk_tiers" }],
    ["a module name has a capital", { profile: "standard", modules: ["Risk"] }],
    ["a module is listed twice", { profile: "standard", modules: ["waivers", "waivers"] }],
    ["the profile is not a text", { profile: 3, modules: [] }],
    ["settings is a list", { profile: "standard", modules: [], settings: [] }],
    ["the key is not an object", "standard"],
    ["an unknown key is in controls", { profile: "standard", modules: [], extra: 1 }],
  ])("marks the controls key as not valid when %s", (_name, controls) => {
    expect(parse({ controls }).controls).toEqual({ state: "not_valid" });
  });

  it("validates each key alone: a bad controls key does not fail main_branch or releases", () => {
    const fields = parse({
      main_branch: "develop",
      controls: { profile: "standard", modules: "x" },
      releases: { production_branch: "production", baseline: "abc", switched_over: "2026-11-01" },
    });
    expect(fields).toEqual({
      mainBranch: "develop",
      controls: { state: "not_valid" },
      releases: { productionBranch: "production", switchedOver: "2026-11-01" },
    });
  });

  it("validates each key alone: a bad main_branch and a bad releases key do not fail controls", () => {
    const fields = parse({
      main_branch: 7,
      releases: { production_branch: "production" },
      controls: { profile: "standard", modules: ["risk_tiers"] },
    });
    expect(fields).toEqual({
      mainBranch: null,
      controls: { state: "ok", profile: "standard", modules: ["risk_tiers"] },
      releases: null,
    });
  });

  it.each([["not json"], ["[1, 2]"], ['"text"'], ["null"], [""]])(
    "does not read %j as a repo config",
    (text) => {
      expect(parseRepoConfig(text)).toEqual({ ok: false });
    },
  );
});

describe("the file branch and the module files", () => {
  it("uses main_branch when it passes the ref rule, else the default branch", () => {
    expect(fileBranchFor("trunk", "develop")).toBe("develop");
    expect(fileBranchFor("trunk", "-x")).toBe("trunk");
    expect(fileBranchFor("trunk", "a..b")).toBe("trunk");
    expect(fileBranchFor("trunk", null)).toBe("trunk");
  });

  it("has no default branch for an empty value or a value that fails the ref rule", () => {
    expect(usableDefaultBranch("trunk")).toBe("trunk");
    expect(usableDefaultBranch("")).toBeNull();
    expect(usableDefaultBranch("-x")).toBeNull();
  });

  it("reads a module file only when its module is on", () => {
    const fields = parse({
      controls: { profile: "custom", modules: ["risk_tiers", "waivers"] },
    });
    expect(filesToRead(fields).map((file) => file.path)).toEqual([
      "_context/controls/risk-map.toml",
      "_context/controls/waivers.toml",
    ]);
    expect(filesToRead(parse({}))).toEqual([]);
  });
});
