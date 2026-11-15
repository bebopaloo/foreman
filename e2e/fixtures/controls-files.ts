import type { SeedForgeFile, SeedRelease, WorkSeed } from "./work-seed.ts";

/**
 * The synthetic data of the Controls view: Control events, forge files and Releases of `acme/app`.
 * Dates are relative to the time of the test.
 *
 * | Waiver  | Expires      | Uses |
 * |---------|--------------|------|
 * | WAIVER-2 | yesterday   | 0    |
 * | WAIVER-7 | in 14 days  | 3    |
 * | WAIVER-4 | in 57 days  | 1    |
 * | WAIVER-9 | not in the register | 2 |
 */

const APP = "acme/app";
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** A title with markup: the page must show it as text. */
export const HOSTILE_CONTROL_TITLE =
  '<img src="https://evil.example/t.png"> **Check** [the payee](https://evil.example)';

const stamp = (time: Date): string => `${time.toISOString().slice(0, 19)}Z`;
const dayOf = (now: Date, offset: number): string =>
  new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);

/** The Control events of 30 days: 3 escalations, and 6 uses of Waivers. */
export function controlsFiles(now: Date): Record<string, string> {
  const time = stamp(new Date(now.getTime() - 20 * MINUTE_MS));
  const escalated = (pr: number, paths: string[], evidence: string[] = []) =>
    JSON.stringify({
      kind: "escalated",
      repo: APP,
      time,
      pr,
      issue: null,
      path_tier: "general",
      tier: "authority",
      paths,
      evidence,
    });
  const waiver = (id: string, pr: number) =>
    JSON.stringify({ kind: "waiver_used", repo: APP, time, pr, waiver: id, finding: "f" });
  const lines = [
    escalated(310, ["src/ledger/transfer.ts", "src/ledger/fees.ts"]),
    escalated(318, ["src/ledger/transfer.ts"], ["src/ledger/transfer.ts:42"]),
    escalated(321, ["src/payee/match.ts"]),
    ...[1, 2, 3].map((pr) => waiver("WAIVER-7", pr)),
    waiver("WAIVER-4", 4),
    ...[5, 6].map((pr) => waiver("WAIVER-9", pr)),
  ];
  return {
    [`factory/controls/${new Date(now.getTime() - 20 * MINUTE_MS).toISOString().slice(0, 10)}.jsonl`]: `${lines.join("\n")}\n`,
  };
}

const MODULES = [
  "control_events",
  "risk_tiers",
  "control_register",
  "waivers",
  "threat_model",
  "release_record",
] as const;

const noGaps = {
  total: 0,
  controlsNotProven: 0,
  directCommits: 0,
  approvalMissing: 0,
  pullRequestsWithoutReview: 0,
  other: 0,
};

function record(over: Record<string, unknown>) {
  return {
    tier: "sensitive",
    pullRequest: 330,
    baseline: null,
    pullRequests: [],
    directCommits: 0,
    approval: {
      required: true,
      approvedBy: "op-login",
      time: "2026-02-01T10:00:00Z",
      threshold: "sensitive",
    },
    controlCounts: null,
    controls: null,
    waivers: [],
    sbomDigest: null,
    modules: null,
    gaps: noGaps,
    ...over,
  };
}

function forgeFiles(now: Date): SeedForgeFile[] {
  const waiver = (id: string, offset: number, covers: unknown, owner = "owner-login") => ({
    id,
    owner,
    approvedBy: "op-login",
    created: "2026-01-01",
    expires: dayOf(now, offset),
    covers,
  });
  return [
    {
      repo: APP,
      path: "_context/controls/risk-map.toml",
      fields: {
        tiers: { authority: 5, sensitive: 3, general: 0, inert: 1 },
        boundaries: [
          { id: "TB-1", globs: 2 },
          { id: "TB-2", globs: 1 },
        ],
      },
    },
    {
      repo: APP,
      path: "_context/controls/controls.toml",
      fields: {
        controls: [
          {
            id: "CTRL-APP-03",
            title: HOSTILE_CONTROL_TITLE,
            owner: "owner-login",
            sources: 2,
            modules: 1,
            manualChecks: 0,
          },
          {
            id: "CTRL-APP-07",
            title: "Review the transfer limit",
            owner: "owner-login",
            sources: 1,
            modules: 2,
            manualChecks: 1,
          },
        ],
      },
    },
    {
      repo: APP,
      path: "_context/controls/waivers.toml",
      fields: {
        waivers: [
          waiver("WAIVER-2", -1, { kind: "control", id: "CTRL-APP-03" }),
          waiver("WAIVER-7", 14, { kind: "check", name: "trivy" }, HOSTILE_CONTROL_TITLE),
          waiver("WAIVER-4", 57, {
            kind: "finding",
            file: "packages/payments/webhook.ts",
            category: "Security",
            ref: "CWE-770",
          }),
        ],
      },
    },
    {
      repo: APP,
      path: "_context/threat-model.md",
      fields: {
        boundaries: ["TB-1", "TB-2"],
        threats: [
          { id: "TM-1", boundary: "TB-1", stride: ["Tampering"], controls: ["CTRL-APP-03"] },
          { id: "TM-4", boundary: "TB-1", stride: ["Spoofing"], controls: [] },
          { id: "TM-5", boundary: "TB-2", stride: [], controls: ["CTRL-OPS-09"] },
        ],
      },
    },
  ];
}

function releases(): SeedRelease[] {
  return [
    {
      repo: APP,
      name: "v2.3.0",
      state: "open",
      issueNumbers: [1, 2],
    },
    {
      repo: APP,
      name: "v2.2.1",
      state: "released",
      issueNumbers: [1, 2, 3, 4, 5, 6],
      assetNames: ["record-v2.2.1.md", "record-v2.2.1.json"],
      record: record({
        controls: [{ id: "CTRL-APP-03", status: "passing" }],
        controlCounts: { passing: 1 },
      }),
    },
    {
      repo: APP,
      name: "v2.2.0",
      state: "released",
      issueNumbers: [7],
      assetNames: ["record-v2.2.0.json"],
      record: record({
        directCommits: 1,
        approval: { required: true, approvedBy: null, time: null, threshold: "sensitive" },
        controls: [{ id: "CTRL-APP-07", status: "untested" }],
        controlCounts: { untested: 1 },
        gaps: { ...noGaps, total: 3, controlsNotProven: 1, directCommits: 1, approvalMissing: 1 },
      }),
    },
    { repo: APP, name: "v2.1.0", state: "released", issueNumbers: [8, 9] },
  ];
}

/** The cache of `acme/app` with the Control modules on, and `acme/site` and `bebopaloo/tools` with none. */
export function controlsWork(now: Date, base: WorkSeed): WorkSeed {
  return {
    ...base,
    pullRequests: [
      ...(base.pullRequests ?? []),
      ...[310, 318, 321].map((number) => ({
        repo: APP,
        number,
        title: `Change ${number.toString()}`,
      })),
      {
        repo: APP,
        number: 330,
        title: "Release 2.3",
        head: "release/2.3",
        base: "production",
        headSha: "b".repeat(40),
      },
    ],
    statuses: [
      {
        repo: APP,
        pullRequest: 330,
        context: "factory/release-review",
        sha: "b".repeat(40),
        state: "fail",
      },
    ],
    repoConfigs: [
      {
        repo: APP,
        modules: MODULES,
        profile: "regulated",
        releases: { productionBranch: "production", switchedOver: "2026-10-01" },
      },
      { repo: "acme/site", modules: [] },
      { repo: "bebopaloo/tools", modules: [] },
    ],
    forgeFiles: forgeFiles(now),
    releases: releases(),
  };
}
