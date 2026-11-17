import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFindings, readFindingsLedger, type LedgerFinding } from "./findings-ledger.ts";

const NOW = new Date("2026-11-15T12:00:00Z");

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    time: "2026-11-15T10:00:00Z",
    run_id: "run-1",
    repo: "acme/app",
    pr: 7,
    issue: 3,
    round: 1,
    sha: "abc1234",
    fingerprint: "0123456789abcdef",
    pass: "Security",
    category: "injection",
    severity: "major",
    refs: ["CWE-89"],
    file: "src/db.ts",
    line: 12,
    status: "verified",
    outcome: "open",
    thread: "https://github.com/acme/app/pull/7#discussion_r1",
    ...over,
  };
}

async function folderWith(text: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "foreman-findings-"));
  await mkdir(path.join(dir, "factory", "findings"), { recursive: true });
  await writeFile(path.join(dir, "factory", "findings", "2026-11-15.jsonl"), text);
  return dir;
}

async function read(lines: (Record<string, unknown> | string)[]) {
  const text = lines.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
  return readFindingsLedger(await folderWith(`${text.join("\n")}\n`), NOW);
}

const all = { repoNames: null, filter: {} } as const;

describe("readFindingsLedger", () => {
  it("reads valid lines", async () => {
    const result = await read([line()]);
    expect(result.folder).toBe("ok");
    expect(result.findings).toHaveLength(1);
    expect(result.skippedLines).toBe(0);
  });

  it("skips and counts a line that is not valid", async () => {
    const result = await read([
      line(),
      "not json",
      line({ severity: "huge", fingerprint: "ffffffffffffffff" }),
      line({ status: "open", fingerprint: "eeeeeeeeeeeeeeee" }),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.skippedLines).toBe(3);
  });

  it("reports a missing folder", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "foreman-findings-"));
    const result = await readFindingsLedger(dir, NOW);
    expect(result.folder).toBe("missing");
    expect(result.findings).toEqual([]);
  });
});

describe("buildFindings", () => {
  async function findings(lines: Record<string, unknown>[]): Promise<LedgerFinding[]> {
    return (await read(lines)).findings;
  }

  it("keeps the latest status and outcome of a fingerprint and the first round", async () => {
    const found = await findings([
      line({ time: "2026-11-15T08:00:00Z", round: 1, outcome: "open" }),
      line({ time: "2026-11-15T09:00:00Z", round: 2, outcome: "fixed" }),
    ]);
    const { rows } = buildFindings(found, all);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ round: 1, outcome: "fixed", time: "2026-11-15T09:00:00Z" });
  });

  it("uses the line order when two lines have the same time", async () => {
    const found = await findings([line({ outcome: "open" }), line({ outcome: "waived" })]);
    expect(buildFindings(found, all).rows[0]?.outcome).toBe("waived");
  });

  it("treats the same fingerprint in two pull requests as two findings", async () => {
    const found = await findings([line({ pr: 7 }), line({ pr: 8 })]);
    expect(buildFindings(found, all).rows).toHaveLength(2);
  });

  it("filters by repo, pass, severity, status and outcome", async () => {
    const found = await findings([
      line({ fingerprint: "a000000000000000" }),
      line({ fingerprint: "b000000000000000", repo: "acme/web" }),
      line({ fingerprint: "c000000000000000", pass: "Correctness" }),
      line({ fingerprint: "d000000000000000", severity: "minor" }),
      line({ fingerprint: "e000000000000000", status: "refuted", outcome: null }),
      line({ fingerprint: "f000000000000000", outcome: "deferred" }),
    ]);
    const fingerprints = (filter: object) =>
      buildFindings(found, { repoNames: null, filter })
        .rows.map((row) => row.fingerprint[0])
        .sort();
    expect(fingerprints({ repo: "ACME/web" })).toEqual(["b"]);
    expect(fingerprints({ pass: "Correctness" })).toEqual(["c"]);
    expect(fingerprints({ severity: "minor" })).toEqual(["d"]);
    expect(fingerprints({ status: "refuted" })).toEqual(["e"]);
    expect(fingerprints({ outcome: "deferred" })).toEqual(["f"]);
    expect(fingerprints({ outcome: "none" })).toEqual(["e"]);
  });

  it("limits the scope to the repo names", async () => {
    const found = await findings([line(), line({ fingerprint: "b000000000000000", repo: "x/y" })]);
    const result = buildFindings(found, { repoNames: new Set(["acme/app"]), filter: {} });
    expect(result.rows).toHaveLength(1);
    expect(result.repos).toEqual(["acme/app"]);
  });

  it("rolls up the Security pass by severity, ignoring the other filters", async () => {
    const found = await findings([
      line({ fingerprint: "a000000000000000", outcome: "open" }),
      line({ fingerprint: "b000000000000000", outcome: null }),
      line({ fingerprint: "c000000000000000", outcome: "fixed" }),
      line({ fingerprint: "d000000000000000", status: "refuted", outcome: "open" }),
      line({ fingerprint: "e000000000000000", status: "dropped", outcome: null }),
      line({ fingerprint: "f000000000000000", severity: "blocker", outcome: "waived" }),
      line({ fingerprint: "g000000000000000", severity: "minor", outcome: "deferred" }),
      line({ fingerprint: "h000000000000000", severity: "minor", outcome: "disagreed" }),
      line({ fingerprint: "i000000000000000", pass: "Correctness" }),
    ]);
    const { bySeverity } = buildFindings(found, {
      repoNames: null,
      filter: { severity: "info" },
    }).security;
    expect(bySeverity.major).toMatchObject({ open: 2, fixed: 1, refuted: 1, total: 4 });
    expect(bySeverity.blocker).toMatchObject({ waived: 1, total: 1 });
    expect(bySeverity.minor).toMatchObject({ deferred: 1, disagreed: 1, total: 2 });
    expect(bySeverity.info.total).toBe(0);
  });

  it("sorts the newest first", async () => {
    const found = await findings([
      line({ fingerprint: "a000000000000000", time: "2026-11-15T08:00:00Z" }),
      line({ fingerprint: "b000000000000000", time: "2026-11-15T09:00:00Z" }),
    ]);
    expect(buildFindings(found, all).rows.map((row) => row.fingerprint[0])).toEqual(["b", "a"]);
  });
});
