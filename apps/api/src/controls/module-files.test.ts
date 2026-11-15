import { describe, expect, it } from "vitest";
import {
  controlRegisterFieldsSchema,
  parseControlRegister,
  parseModuleFile,
  parseRiskMap,
  parseThreatModel,
  parseWaiverRegister,
  riskMapFieldsSchema,
  threatModelFieldsSchema,
  waiverRegisterFieldsSchema,
} from "./files.ts";

// The fixtures follow the factory templates, with their examples switched on and synthetic values.

const RISK_MAP = `
[[tier]]
name = "authority"
paths = ["contracts/**", "packages/ledger/**", "packages/payments/**"]

[[tier]]
name = "sensitive"
paths = ["packages/auth/**", "infra/**"]

[[tier]]
name = "inert"
paths = ["**/*.md"]

[[boundary]]
id = "TB-1"
paths = ["apps/web/**"]

[[boundary]]
id = "TB-2"
paths = ["packages/payments/adapters/**", "apps/api/src/routes/webhooks/**"]
`;

const CONTROLS = `
tests = ["**/*.test.ts"]

[[control]]
id = "CTRL-PAY-03"
title = "A release needs the buyer's recorded approval"
sources = ["PSRs 2017 reg 67"]
owner = "Operator"
modules = ["packages/payments/**"]

[[control]]
id = "CTRL-REL-01"
title = "Code that no human reviewed never reaches production"
sources = ["ADR 0015"]
owner = "Operator"
modules = [".github/workflows/**", "infra/**"]
manual_checks = [
  "The release-separation check passes on every pull request",
  "The production environment deploys only from the production branch",
]
`;

const WAIVERS = `
[[waiver]]
id = "WAIVER-1"
reason = "SYNTHETIC-REASON The provider SDK has no fix yet"
risk = "SYNTHETIC-RISK A crafted webhook could slow the API"
owner = "Operator"
approved_by = "synthetic-approver"
created = 2026-11-14
expires = 2027-01-31

[waiver.covers]
kind = "finding"
file = "packages/payments/webhook.ts"
category = "Security"
ref = "CWE-770"

[[waiver]]
id = "WAIVER-2"
reason = "SYNTHETIC-REASON no fix"
risk = "SYNTHETIC-RISK scanner noise"
owner = "Operator"
approved_by = "synthetic-approver"
created = 2026-11-01
expires = 2026-12-01

[waiver.covers]
kind = "check"
name = "trivy"

[[waiver]]
id = "WAIVER-3"
reason = "SYNTHETIC-REASON not met yet"
risk = "SYNTHETIC-RISK gap"
owner = "Operator"
approved_by = "synthetic-approver"
created = 2026-11-01
expires = 2026-12-15

[waiver.covers]
kind = "control"
id = "CTRL-PAY-03"
`;

const THREATS = `# Threat model

<!--
## TB-9 Inside a comment

### TM-9 Inside a comment
- STRIDE: Spoofing
- Controls: CTRL-OPS-09
-->

## TB-1 Browser to API

The client app calls the API over HTTPS.

### TM-1 Stolen session cookie
- STRIDE: Spoofing
- Controls: CTRL-AUTH-01
- Notes: SYNTHETIC-NOTE

## TB-2 API to payment provider

### TM-2 Forged or replayed webhook
- STRIDE: Spoofing, Tampering
- Controls: CTRL-PAY-04, CTRL-PAY-03

### TM-3 Release without approval
- STRIDE: Elevation of privilege
- Controls: none
`;

function ok<T>(result: { ok: true; fields: T } | { ok: false }): T {
  if (!result.ok) throw new Error("the file was not readable");
  return result.fields;
}

describe("the Risk map parser", () => {
  it("counts the globs of each Risk tier and lists the boundaries with their glob counts", () => {
    const result = parseRiskMap(RISK_MAP);
    expect(result).toEqual({
      ok: true,
      fields: {
        tiers: { authority: 3, sensitive: 2, general: 0, inert: 1 },
        boundaries: [
          { id: "TB-1", globs: 1 },
          { id: "TB-2", globs: 2 },
        ],
      },
      skipped: [],
    });
    expect(() => riskMapFieldsSchema.parse(ok(result))).not.toThrow();
  });

  it("keeps no glob text", () => {
    expect(JSON.stringify(parseRiskMap(RISK_MAP))).not.toContain("packages/");
  });

  it("reads the factory template, which holds one inert tier, as it is", () => {
    const template = `[[tier]]\nname = "inert"\npaths = ["**/*.md"]\n`;
    expect(ok(parseRiskMap(template)).tiers).toEqual({
      authority: 0,
      sensitive: 0,
      general: 0,
      inert: 1,
    });
  });

  it("skips a tier or a boundary that fails its rules, with its position and field", () => {
    const text = `
[[tier]]
name = "critical"
paths = ["a/**"]

[[tier]]
name = "authority"
paths = []

[[tier]]
name = "sensitive"
paths = ["infra/**"]
colour = "red"

[[tier]]
name = "general"
paths = ["src/**"]

[[tier]]
name = "general"
paths = ["lib/**"]

[[boundary]]
id = "TB-X"
paths = ["a/**"]

[[boundary]]
id = "TB-1"
paths = ["a/**"]

[[boundary]]
id = "TB-1"
paths = ["b/**"]

[[boundary]]
id = "TB-3"
`;
    const result = parseRiskMap(text);
    expect(result).toEqual({
      ok: true,
      fields: {
        tiers: { authority: 0, sensitive: 0, general: 1, inert: 0 },
        boundaries: [{ id: "TB-1", globs: 1 }],
      },
      skipped: [
        { position: 1, field: "tier.name" },
        { position: 2, field: "tier.paths" },
        { position: 3, field: "tier.unknown_key" },
        { position: 5, field: "tier.name" },
        { position: 1, field: "boundary.id" },
        { position: 3, field: "boundary.id" },
        { position: 4, field: "boundary.paths" },
      ],
    });
  });

  it("is not readable when the text is not TOML or a key is not a list of tables", () => {
    expect(parseRiskMap("tier = [")).toEqual({ ok: false });
    expect(parseRiskMap('tier = "authority"')).toEqual({ ok: false });
    expect(parseRiskMap("boundary = 3")).toEqual({ ok: false });
  });

  it("reads an empty file as a map with no entries", () => {
    expect(parseRiskMap("")).toEqual({
      ok: true,
      fields: { tiers: { authority: 0, sensitive: 0, general: 0, inert: 0 }, boundaries: [] },
      skipped: [],
    });
  });
});

describe("the Control register parser", () => {
  it("keeps the ID, the title, the owner and the counts of each Control", () => {
    const result = parseControlRegister(CONTROLS);
    expect(result).toEqual({
      ok: true,
      fields: {
        controls: [
          {
            id: "CTRL-PAY-03",
            title: "A release needs the buyer's recorded approval",
            owner: "Operator",
            sources: 1,
            modules: 1,
            manualChecks: 0,
          },
          {
            id: "CTRL-REL-01",
            title: "Code that no human reviewed never reaches production",
            owner: "Operator",
            sources: 1,
            modules: 2,
            manualChecks: 2,
          },
        ],
      },
      skipped: [],
    });
    expect(() => controlRegisterFieldsSchema.parse(ok(result))).not.toThrow();
  });

  it("cuts a title to 200 characters", () => {
    const text = `[[control]]\nid = "CTRL-A-1"\ntitle = "${"t".repeat(250)}"\nowner = "O"\nmodules = ["a"]\n`;
    expect(ok(parseControlRegister(text)).controls[0]?.title).toHaveLength(200);
  });

  it("skips a Control that fails its rules and keeps the others", () => {
    const text = `
[[control]]
id = "PAY-03"
title = "t"
owner = "O"
modules = ["a"]

[[control]]
id = "CTRL-A-1"
owner = "O"
modules = ["a"]

[[control]]
id = "CTRL-A-2"
title = "t"
owner = "O"
modules = []

[[control]]
id = "CTRL-A-3"
title = "t"
owner = "O"
modules = ["a"]
manual_checks = "check"

[[control]]
id = "CTRL-A-4"
title = "t"
owner = "O"
modules = ["a"]
risk = "x"

[[control]]
id = "CTRL-A-5"
title = "ok"
owner = "O"
modules = ["a"]

[[control]]
id = "CTRL-A-5"
title = "again"
owner = "O"
modules = ["a"]
`;
    const result = parseControlRegister(text);
    expect(ok(result).controls.map((control) => control.id)).toEqual(["CTRL-A-5"]);
    expect(result).toMatchObject({
      skipped: [
        { position: 1, field: "id" },
        { position: 2, field: "title" },
        { position: 3, field: "modules" },
        { position: 4, field: "manual_checks" },
        { position: 5, field: "unknown_key" },
        { position: 7, field: "id" },
      ],
    });
  });

  it("is not readable when the text is not TOML or control is not a list", () => {
    expect(parseControlRegister("[[control]")).toEqual({ ok: false });
    expect(parseControlRegister("control = 1")).toEqual({ ok: false });
  });
});

describe("the Waiver register parser", () => {
  it("keeps the ID, the owner, the approver, the two dates and the covers of each Waiver", () => {
    const result = parseWaiverRegister(WAIVERS);
    expect(result).toEqual({
      ok: true,
      fields: {
        waivers: [
          {
            id: "WAIVER-1",
            owner: "Operator",
            approvedBy: "synthetic-approver",
            created: "2026-11-14",
            expires: "2027-01-31",
            covers: {
              kind: "finding",
              file: "packages/payments/webhook.ts",
              category: "Security",
              ref: "CWE-770",
            },
          },
          {
            id: "WAIVER-2",
            owner: "Operator",
            approvedBy: "synthetic-approver",
            created: "2026-11-01",
            expires: "2026-12-01",
            covers: { kind: "check", name: "trivy" },
          },
          {
            id: "WAIVER-3",
            owner: "Operator",
            approvedBy: "synthetic-approver",
            created: "2026-11-01",
            expires: "2026-12-15",
            covers: { kind: "control", id: "CTRL-PAY-03" },
          },
        ],
      },
      skipped: [],
    });
    expect(() => waiverRegisterFieldsSchema.parse(ok(result))).not.toThrow();
  });

  it("never keeps the reason or the risk of a Waiver", () => {
    const text = JSON.stringify(parseWaiverRegister(WAIVERS));
    expect(text).not.toContain("SYNTHETIC-REASON");
    expect(text).not.toContain("SYNTHETIC-RISK");
    expect(text).not.toMatch(/reason|risk/);
  });

  it("keeps a finding Waiver with no ref, with a null ref", () => {
    const text = WAIVERS.replace('ref = "CWE-770"\n', "");
    expect(ok(parseWaiverRegister(text)).waivers[0]?.covers).toEqual({
      kind: "finding",
      file: "packages/payments/webhook.ts",
      category: "Security",
      ref: null,
    });
  });

  it("is not readable when the text is not valid TOML", () => {
    expect(parseWaiverRegister("[[waiver]]\nid = ")).toEqual({ ok: false });
    expect(parseWaiverRegister("waiver = 5")).toEqual({ ok: false });
  });

  it("keeps the valid Waiver and skips one with no expires, with its position and field and no value", () => {
    const text = `${WAIVERS.slice(0, WAIVERS.indexOf("[[waiver]]", 20))}
[[waiver]]
id = "WAIVER-8"
reason = "SYNTHETIC-REASON"
risk = "SYNTHETIC-RISK"
owner = "Operator"
approved_by = "synthetic-approver"
created = 2026-11-14

[waiver.covers]
kind = "check"
name = "trivy"
`;
    const result = parseWaiverRegister(text);
    expect(ok(result).waivers.map((waiver) => waiver.id)).toEqual(["WAIVER-1"]);
    expect(result).toMatchObject({ skipped: [{ position: 2, field: "expires" }] });
    expect(JSON.stringify(result)).not.toContain("WAIVER-8");
  });

  const VALID = (extra: string, covers = `[waiver.covers]\nkind = "check"\nname = "trivy"`) =>
    `[[waiver]]\nid = "WAIVER-1"\nreason = "r"\nrisk = "k"\nowner = "O"\napproved_by = "A"\n${extra}\n${covers}\n`;
  const DATES = "created = 2026-11-14\nexpires = 2027-01-31";

  it.each([
    ["a missing reason", VALID(DATES).replace('reason = "r"\n', ""), "reason"],
    ["an empty risk", VALID(DATES).replace('risk = "k"', 'risk = ""'), "risk"],
    ["a missing owner", VALID(DATES).replace('owner = "O"\n', ""), "owner"],
    ["a missing approver", VALID(DATES).replace('approved_by = "A"\n', ""), "approved_by"],
    ["a missing created date", VALID("expires = 2027-01-31"), "created"],
    [
      "a created date that is a date-time",
      VALID("created = 2026-11-14T10:00:00Z\nexpires = 2027-01-31"),
      "created",
    ],
    [
      "an expires date that is text",
      VALID('created = 2026-11-14\nexpires = "2027-01-31"'),
      "expires",
    ],
    [
      "an expires date before created",
      VALID("created = 2026-11-14\nexpires = 2026-11-13"),
      "expires",
    ],
    ["an ID that is not WAIVER-<n>", VALID(DATES).replace("WAIVER-1", "W-1"), "id"],
    ["an unknown key", VALID(`${DATES}\nnote = "x"`), "unknown_key"],
    ["no covers", VALID(DATES, ""), "covers"],
    [
      "a covers kind that is not known",
      VALID(DATES, `[waiver.covers]\nkind = "file"`),
      "covers.kind",
    ],
    ["a check with no name", VALID(DATES, `[waiver.covers]\nkind = "check"`), "covers.name"],
    ["a control with no id", VALID(DATES, `[waiver.covers]\nkind = "control"`), "covers.id"],
    [
      "a finding with no category",
      VALID(DATES, `[waiver.covers]\nkind = "finding"\nfile = "a.ts"`),
      "covers.category",
    ],
    [
      "a finding with no file",
      VALID(DATES, `[waiver.covers]\nkind = "finding"\ncategory = "Security"`),
      "covers.file",
    ],
    [
      "a covers key of another kind",
      VALID(DATES, `[waiver.covers]\nkind = "check"\nname = "t"\nfile = "a.ts"`),
      "covers.unknown_key",
    ],
  ])("skips a Waiver with %s", (_name, text, field) => {
    const result = parseWaiverRegister(text);
    expect(result).toEqual({
      ok: true,
      fields: { waivers: [] },
      skipped: [{ position: 1, field }],
    });
  });

  it("skips the second Waiver of an ID that the register lists twice", () => {
    const text = `${VALID(DATES)}\n${VALID(DATES)}`;
    const result = parseWaiverRegister(text);
    expect(ok(result).waivers).toHaveLength(1);
    expect(result).toMatchObject({ skipped: [{ position: 2, field: "id" }] });
  });

  it("keeps a Waiver that has already expired, because the view decides the expiry", () => {
    const text = VALID("created = 2025-01-01\nexpires = 2025-02-01");
    expect(ok(parseWaiverRegister(text)).waivers).toHaveLength(1);
  });
});

describe("the Threat model parser", () => {
  it("keeps the boundary IDs and, for each threat, its ID, boundary, STRIDE categories and Control IDs", () => {
    const result = parseThreatModel(THREATS);
    expect(result).toEqual({
      ok: true,
      fields: {
        boundaries: ["TB-1", "TB-2"],
        threats: [
          { id: "TM-1", boundary: "TB-1", stride: ["Spoofing"], controls: ["CTRL-AUTH-01"] },
          {
            id: "TM-2",
            boundary: "TB-2",
            stride: ["Spoofing", "Tampering"],
            controls: ["CTRL-PAY-04", "CTRL-PAY-03"],
          },
          {
            id: "TM-3",
            boundary: "TB-2",
            stride: ["Elevation of privilege"],
            controls: [],
          },
        ],
      },
      skipped: [],
    });
    expect(() => threatModelFieldsSchema.parse(ok(result))).not.toThrow();
  });

  it("leaves out HTML comments, and keeps no names and no other lines", () => {
    const text = JSON.stringify(parseThreatModel(THREATS));
    expect(text).not.toContain("TB-9");
    expect(text).not.toContain("TM-9");
    expect(text).not.toContain("SYNTHETIC-NOTE");
    expect(text).not.toContain("Stolen");
    expect(text).not.toContain("HTTPS");
  });

  it("gives no boundary and no threat for the factory template, which holds only a comment", () => {
    expect(parseThreatModel("# Threat model\n\n<!--\n## TB-1 X\n### TM-1 Y\n-->\n")).toEqual({
      ok: true,
      fields: { boundaries: [], threats: [] },
      skipped: [],
    });
  });

  it("skips a threat that has a problem, with its position and field", () => {
    const text = `
### TM-1 Before any boundary
- STRIDE: Spoofing
- Controls: none

## TB-1 One

### TM-2 No STRIDE line
- Controls: none

### TM-3 No Controls line
- STRIDE: Tampering

### TM-4 Bad category
- STRIDE: Hacking
- Controls: none

### TM-5 Bad Control ID
- STRIDE: Spoofing
- Controls: pay-03

### TM-6 Fine
- STRIDE: Repudiation
- Controls: NONE

### TM-6 Listed twice
- STRIDE: Repudiation
- Controls: none

## Not a boundary

### TM-7 Under a heading that is not a boundary
- STRIDE: Spoofing
- Controls: none

## TB-1 Same boundary again
`;
    const result = parseThreatModel(text);
    expect(ok(result).threats.map((threat) => threat.id)).toEqual(["TM-6"]);
    expect(ok(result).boundaries).toEqual(["TB-1"]);
    expect(result).toMatchObject({
      skipped: [
        { position: 2, field: "boundary.id" },
        { position: 1, field: "threat.boundary" },
        { position: 2, field: "threat.stride" },
        { position: 3, field: "threat.controls" },
        { position: 4, field: "threat.stride" },
        { position: 5, field: "threat.controls" },
        { position: 7, field: "threat.id" },
        { position: 8, field: "threat.boundary" },
      ],
    });
  });
});

describe("the parser by path", () => {
  it("picks the parser of each module file and none for another path", () => {
    expect(parseModuleFile("_context/controls/risk-map.toml", RISK_MAP)).toMatchObject({
      ok: true,
    });
    expect(parseModuleFile("_context/controls/controls.toml", CONTROLS)).toMatchObject({
      ok: true,
    });
    expect(parseModuleFile("_context/controls/waivers.toml", WAIVERS)).toMatchObject({ ok: true });
    expect(parseModuleFile("_context/threat-model.md", THREATS)).toMatchObject({ ok: true });
    expect(parseModuleFile("_context/controls/waivers.toml", "[[waiver")).toEqual({ ok: false });
    expect(parseModuleFile(".claude/factory.json", "{}")).toBeNull();
  });
});
