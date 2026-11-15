import { describe, expect, it } from "vitest";
import { listedRules, parseRepoConfig, parseRuleFile } from "./files.ts";
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
      factory_owned: 1,
      main_branch: "develop",
    });
    expect(fields).toMatchObject({
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
    expect(fields).toMatchObject({
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
    expect(fields).toMatchObject({
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

describe("the rule keys of the repo config", () => {
  it("keeps the rule names, the Stack pack and the factory core version", () => {
    const fields = parse({
      rules: ["coding", "react"],
      compliance: ["gdpr"],
      stack_pack: { name: "stack-ts", version: "0.6.0", extra: 1 },
      factory_core_version: "0.30.0",
    });
    expect(fields).toMatchObject({
      rules: { state: "ok", value: ["coding", "react"] },
      compliance: { state: "ok", value: ["gdpr"] },
      stackPack: { state: "ok", value: { name: "stack-ts", version: "0.6.0" } },
      factoryCoreVersion: { state: "ok", value: "0.30.0" },
    });
  });

  it("reads absent keys as empty lists and null", () => {
    expect(parse({})).toMatchObject({
      rules: { state: "ok", value: [] },
      compliance: { state: "ok", value: [] },
      stackPack: { state: "ok", value: null },
      factoryCoreVersion: { state: "ok", value: null },
    });
  });

  it.each([
    ["rules", "coding"],
    ["rules", ["Coding"]],
    ["rules", ["../x"]],
    ["rules", [3]],
    ["rules", Array.from({ length: 51 }, (_, index) => `r${String(index)}`)],
    ["compliance", { gdpr: true }],
    ["stack_pack", "stack-ts"],
    ["stack_pack", { name: "stack-ts" }],
    ["stack_pack", { name: "Stack", version: "1" }],
    ["factory_core_version", 3],
    ["factory_core_version", "1 2"],
    ["factory_core_version", "1".repeat(65)],
  ])("marks only the key %s as not valid for %j", (key, value) => {
    const fields = parse({ main_branch: "develop", rules: ["coding"], [key]: value });
    expect(fields.mainBranch).toBe("develop");
    const states = {
      rules: fields.rules.state,
      compliance: fields.compliance.state,
      stack_pack: fields.stackPack.state,
      factory_core_version: fields.factoryCoreVersion.state,
    };
    expect(Object.entries(states).filter(([, state]) => state === "not_valid")).toEqual([
      [key, "not_valid"],
    ]);
  });

  it("accepts 50 names", () => {
    const names = Array.from({ length: 50 }, (_, index) => `r${String(index)}`);
    expect(parse({ rules: names }).rules).toEqual({ state: "ok", value: names });
  });

  it("lists each distinct name once, the rules before the Compliance templates", () => {
    const fields = parse({ rules: ["coding", "coding", "react"], compliance: ["react", "gdpr"] });
    expect(listedRules(fields)).toEqual([
      { name: "coding", kind: "rule" },
      { name: "react", kind: "rule" },
      { name: "gdpr", kind: "compliance" },
    ]);
  });

  it("lists no name when a rule key is not valid", () => {
    expect(listedRules(parse({ rules: "coding" }))).toBeNull();
    expect(listedRules(parse({ compliance: 1 }))).toBeNull();
  });
});

describe("the stamp line of a rule file", () => {
  const STAMP = "<!-- factory-core 0.8.1: from Rule template coding. The team owns this file. -->";
  const sha = (text: string) => parseRuleFile("x", "rule", text).textHash;

  it("reads the stamp on the first line and hashes the text without it", () => {
    const fields = parseRuleFile("coding", "rule", `${STAMP}\n# Coding\n`);
    expect(fields).toMatchObject({
      kind: "rule",
      stampPlugin: "factory-core",
      stampVersion: "0.8.1",
      stampName: "coding",
    });
    expect(fields.textHash).toBe(sha("# Coding\n"));
    expect(fields.textHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the stamp after the front matter", () => {
    const fields = parseRuleFile(
      "coding",
      "compliance",
      `---\npaths: a\n---\n${STAMP}\n# Coding\n`,
    );
    expect(fields).toMatchObject({ kind: "compliance", stampVersion: "0.8.1" });
    expect(fields.textHash).toBe(sha("---\npaths: a\n---\n# Coding\n"));
  });

  it("does not read a stamp on the first line of a file with front matter", () => {
    const text = `${STAMP}\n---\na: 1\n---\n# Coding\n`;
    expect(parseRuleFile("coding", "rule", text).stampPlugin).toBe("factory-core");
    const inside = `---\n${STAMP}\n---\n# Coding\n`;
    const fields = parseRuleFile("coding", "rule", inside);
    expect(fields.stampPlugin).toBeNull();
    expect(fields.textHash).toBe(sha(inside));
  });

  it.each([
    ["no stamp", "# Coding\n"],
    ["a stamp that names another template", STAMP.replace("coding", "security")],
    ["a stamp with a changed sentence", STAMP.replace("The team", "A team")],
    ["a stamp with a capital in the plugin", STAMP.replace("factory-core", "Factory")],
    ["a stamp with a line end of CR LF", `${STAMP}\r`],
  ])("hashes the whole text for %s", (_name, first) => {
    const text = `${first}\n# Coding\n`;
    const fields = parseRuleFile("coding", "rule", text);
    expect(fields).toMatchObject({ stampPlugin: null, stampVersion: null, stampName: null });
    expect(fields.textHash).toBe(sha(text));
  });

  it("keeps the line ends and the spaces of the text", () => {
    expect(sha("a\n")).not.toBe(sha("a\r\n"));
    expect(sha("a \n")).not.toBe(sha("a\n"));
  });

  it("reads a stamp that is the last line with no line end", () => {
    const fields = parseRuleFile("coding", "rule", STAMP);
    expect(fields.stampName).toBe("coding");
    expect(fields.textHash).toBe(sha(""));
  });

  it("never holds the text", () => {
    expect(
      JSON.stringify(parseRuleFile("coding", "rule", `${STAMP}\nSECRET-TEXT\n`)),
    ).not.toContain("SECRET-TEXT");
  });
});
