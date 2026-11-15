import path from "node:path";
import { schema } from "@foreman/db";
import {
  ControlsRegisterResponse,
  ControlsReleasesResponse,
  ControlsResponse,
  ControlsWaiversResponse,
} from "@foreman/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { parseReleaseRecord } from "../src/controls/release-records.ts";
import { repoId } from "../src/work/repo-list.ts";
import { writeJsonl } from "./dash-fixtures.ts";
import { openTestDatabase, testConfig } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import { recordJson, recordWithGaps } from "./release-record-fixtures.ts";
import { writeTokens } from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_pull_requests, work_commit_statuses, work_releases, work_forge_releases, work_release_records, work_forge_files`,
  );
});

const NOW = new Date("2026-11-14T12:00:00Z");
const PAY = repoId("github.com", "acme", "pay");
const WEB = repoId("github.com", "acme", "web");
const GLOBEX = repoId("github.com", "globex", "api");
const T0 = new Date("2026-11-14T10:00:00Z");
const SHA = "abcdef0123456789".repeat(2) + "abcdef01";
const TOKENS = { "github.com/acme": "t", "github.com/globex": "t" };

const WAIVERS = "_context/controls/waivers.toml";
const RISK_MAP = "_context/controls/risk-map.toml";
const CONTROL_REGISTER = "_context/controls/controls.toml";
const THREAT_MODEL = "_context/threat-model.md";
const CONFIG = ".claude/factory.json";

interface Setup {
  repos?: unknown[];
  tokens?: Record<string, string>;
  events?: Record<string, unknown>[];
}

async function appFor({ repos, tokens = TOKENS, events = [] }: Setup = {}) {
  const claudeDir = await makeClaudeDir({
    repos: repos ?? [
      entry("acme/pay", "acme"),
      entry("acme/web", "acme"),
      entry("globex/api", "globex"),
    ],
  });
  const tokensFile = await writeTokens(claudeDir, tokens);
  if (events.length > 0) {
    await writeJsonl(path.join(claudeDir, "factory"), "controls", "2026-11-10", events);
  }
  const config = { ...testConfig, FOREMAN_CLAUDE_DIR: claudeDir, FOREMAN_TOKENS_FILE: tokensFile };
  return buildApp({ config, db: database.db, logger: false, now: () => NOW });
}

type App = Awaited<ReturnType<typeof appFor>>;

async function get(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function view(app: App, url = "/api/controls") {
  const { status, body } = await get(app, url);
  expect(status).toBe(200);
  return ControlsResponse.parse(body);
}

async function waivers(app: App, url = "/api/controls/waivers") {
  const { status, body } = await get(app, url);
  expect(status).toBe(200);
  return ControlsWaiversResponse.parse(body);
}

async function releases(app: App, url = "/api/controls/releases") {
  const { status, body } = await get(app, url);
  expect(status).toBe(200);
  return ControlsReleasesResponse.parse(body);
}

async function seedRepo(
  id: string,
  owner: string,
  name: string,
  over: Partial<typeof schema.workRepos.$inferInsert> = {},
) {
  await database.db.insert(schema.workRepos).values({
    id,
    host: "github.com",
    owner,
    name,
    lastGoodFetchAt: T0,
    defaultBranch: "main",
    fileBranch: "main",
    repoState: "ok",
    ...over,
  });
}

async function seedFile(
  repo: string,
  filePath: string,
  fields: unknown,
  over: Partial<typeof schema.workForgeFiles.$inferInsert> = {},
) {
  await database.db.insert(schema.workForgeFiles).values({
    repoId: repo,
    path: filePath,
    ref: "main",
    sha: SHA,
    size: 10,
    fetchedAt: T0,
    state: "ok",
    skipped: [],
    fields,
    ...over,
  });
}

function configFields(modules: string[], profile = "regulated") {
  return {
    mainBranch: null,
    controls: modules.length === 0 ? { state: "none" } : { state: "ok", profile, modules },
    releases: null,
  };
}

const covers = { kind: "check", name: "trivy" };

function waiver(id: string, expires: string, over: Record<string, unknown> = {}) {
  return {
    id,
    owner: "owner-login",
    approvedBy: "op-login",
    created: "2026-01-01",
    expires,
    covers,
    ...over,
  };
}

function waiverUsed(repo: string, id: string, pr: number) {
  return {
    kind: "waiver_used",
    repo,
    time: "2026-11-10T10:00:00Z",
    pr,
    waiver: id,
    finding: "f",
  };
}

function escalation(repo: string, pr: number, paths: string[], over: Record<string, unknown> = {}) {
  return {
    kind: "escalated",
    repo,
    time: `2026-11-10T10:0${(pr % 10).toString()}:00Z`,
    pr,
    issue: null,
    path_tier: "general",
    tier: "authority",
    paths,
    evidence: [],
    ...over,
  };
}

describe("Escalations by path", () => {
  it("counts each path, shows the newest pull request and evidence, and counts the repeated paths", async () => {
    const app = await appFor({
      events: [
        escalation("acme/pay", 310, ["src/ledger/transfer.ts", "src/ledger/fees.ts"], {
          time: "2026-11-10T09:00:00Z",
        }),
        escalation("acme/pay", 318, ["src/ledger/transfer.ts"], {
          time: "2026-11-10T10:00:00Z",
          evidence: ["src/ledger/transfer.ts:42"],
        }),
        escalation("acme/pay", 321, ["src/payee/match.ts"], {
          time: "2026-11-10T11:00:00Z",
          path_tier: null,
          tier: null,
        }),
      ],
    });
    await seedRepo(PAY, "acme", "pay");
    await database.db.insert(schema.workPullRequests).values({
      repoId: PAY,
      number: 318,
      title: "t",
      state: "closed",
      draft: false,
      headBranch: "h",
      baseBranch: "main",
      author: "a",
      checks: "pass",
      link: "https://github.com/acme/pay/pull/318",
      lastListedAt: T0,
    });
    const { escalations } = await view(app);
    expect(escalations.total).toBe(3);
    expect(escalations.repeatedPaths).toBe(1);
    const [first, second, third] = escalations.rows;
    expect(first).toMatchObject({
      path: "src/ledger/transfer.ts",
      count: 2,
      pathTier: "general",
      tier: "authority",
      evidence: "src/ledger/transfer.ts:42",
      latestPull: { number: 318, link: "https://github.com/acme/pay/pull/318" },
    });
    expect([second?.path, second?.count]).toEqual(["src/payee/match.ts", 1]);
    expect([third?.path, third?.count]).toEqual(["src/ledger/fees.ts", 1]);
  });

  it("shows at most 50 rows and the total", async () => {
    const events = Array.from({ length: 55 }, (_, index) =>
      escalation("acme/pay", index + 1, [`src/file-${index.toString().padStart(2, "0")}.ts`]),
    );
    const app = await appFor({ events });
    const { escalations } = await view(app);
    expect(escalations.rows).toHaveLength(50);
    expect(escalations.total).toBe(55);
  });

  it("shows the escalations of events when no repo is connected", async () => {
    const app = await appFor({ tokens: {}, events: [escalation("acme/pay", 1, ["a.ts"])] });
    const result = await view(app);
    expect(result.state).toBe("not_connected");
    expect(result.escalations.rows).toHaveLength(1);
    expect(result.modules).toEqual([]);
  });
});

describe("Waivers and their expiry", () => {
  async function waiverApp(events: Record<string, unknown>[] = []) {
    const app = await appFor({ events });
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, CONFIG, configFields(["waivers"]));
    return app;
  }

  it("orders the Waivers by expiry date and counts their uses", async () => {
    const app = await waiverApp([
      ...[1, 2, 3].map((pr) => waiverUsed("acme/pay", "WAIVER-7", pr)),
      waiverUsed("acme/pay", "WAIVER-4", 9),
    ]);
    await seedFile(PAY, WAIVERS, {
      waivers: [
        waiver("WAIVER-7", "2026-11-28"),
        waiver("WAIVER-4", "2027-01-10"),
        waiver("WAIVER-2", "2026-11-13"),
      ],
    });
    const { items } = await waivers(app);
    expect(items.map((row) => [row.id, row.expiry, row.days, row.uses])).toEqual([
      ["WAIVER-2", "expired", -1, 0],
      ["WAIVER-7", "expiring", 14, 3],
      ["WAIVER-4", "current", 57, 1],
    ]);
  });

  it("shows a Waiver that expires today as expired", async () => {
    const app = await waiverApp();
    await seedFile(PAY, WAIVERS, { waivers: [waiver("WAIVER-1", "2026-11-14")] });
    const { items } = await waivers(app);
    expect(items[0]).toMatchObject({ expiry: "expired", days: 0 });
  });

  it("shows a Waiver that is 30 days away as expiring and 31 days away as current", async () => {
    const app = await waiverApp();
    await seedFile(PAY, WAIVERS, {
      waivers: [waiver("WAIVER-1", "2026-12-14"), waiver("WAIVER-2", "2026-12-15")],
    });
    const { items } = await waivers(app);
    expect(items.map((row) => row.expiry)).toEqual(["expiring", "current"]);
  });

  it("shows a used Waiver that the register does not have, with the file branch", async () => {
    const app = await waiverApp([
      waiverUsed("acme/pay", "WAIVER-9", 1),
      waiverUsed("acme/pay", "WAIVER-9", 2),
    ]);
    await seedFile(PAY, WAIVERS, { waivers: [waiver("WAIVER-1", "2027-03-01")] });
    const { items } = await waivers(app);
    expect(items.at(-1)).toMatchObject({
      id: "WAIVER-9",
      expiry: "not_in_register",
      registerBranch: "main",
      uses: 2,
      newestPull: { number: 2 },
    });
  });

  it("shows 'register not read' when the register is not readable, and keeps the uses", async () => {
    const app = await waiverApp([waiverUsed("acme/pay", "WAIVER-9", 1)]);
    await seedFile(PAY, WAIVERS, null, { state: "not_readable", sha: null });
    const { items } = await waivers(app);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "WAIVER-9", expiry: "register_not_read", uses: 1 });
    const { artefacts } = await view(app);
    expect(artefacts[0]?.waiverRegister.state).toBe("not_readable");
  });

  it("shows the valid Waivers of a register with a skipped entry, and the position and field", async () => {
    const app = await waiverApp();
    await seedFile(
      PAY,
      WAIVERS,
      { waivers: [waiver("WAIVER-1", "2027-03-01")] },
      {
        skipped: [{ position: 2, field: "expires" }],
      },
    );
    expect((await waivers(app)).items).toHaveLength(1);
    const { artefacts, skipped } = await view(app);
    expect(artefacts[0]?.waiverRegister.skipped).toEqual([{ position: 2, field: "expires" }]);
    expect(skipped.entries).toBe(1);
  });

  it("shows what each Waiver covers, and never a reason or a risk", async () => {
    const app = await waiverApp();
    await seedFile(PAY, WAIVERS, {
      waivers: [
        waiver("WAIVER-1", "2027-01-01", {
          covers: {
            kind: "finding",
            file: "packages/payments/webhook.ts",
            category: "Security",
            ref: "CWE-770",
          },
        }),
        waiver("WAIVER-2", "2027-01-02"),
        waiver("WAIVER-3", "2027-01-03", { covers: { kind: "control", id: "CTRL-PAY-03" } }),
      ],
    });
    const { items } = await waivers(app);
    expect(items.map((row) => row.covers)).toEqual([
      {
        kind: "finding",
        file: "packages/payments/webhook.ts",
        category: "Security",
        ref: "CWE-770",
      },
      { kind: "check", name: "trivy" },
      { kind: "control", id: "CTRL-PAY-03" },
    ]);
    const text = JSON.stringify(items);
    expect(text).not.toContain("reason");
    expect(text).not.toContain("risk");
  });

  it("pages 120 Waivers, and rejects a bad limit, an unknown key and a bad cursor", async () => {
    const app = await waiverApp();
    await seedFile(PAY, WAIVERS, {
      waivers: Array.from({ length: 120 }, (_, index) =>
        waiver(`WAIVER-${(index + 1).toString()}`, "2027-06-01"),
      ),
    });
    const first = await waivers(app);
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = await waivers(app, `/api/controls/waivers?cursor=${first.nextCursor ?? ""}`);
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((row) => row.id));
    expect(ids.size).toBe(120);
    for (const query of ["limit=501", "limit=0", "extra=1", "cursor=not-a-cursor"]) {
      expect((await get(app, `/api/controls/waivers?${query}`)).status).toBe(400);
    }
  });
});

describe("Releases with their records", () => {
  async function releaseApp(modules = ["release_record"]) {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, CONFIG, configFields(modules));
    return app;
  }

  async function seedRelease(name: string, state: string, issues = 6) {
    await database.db.insert(schema.workReleases).values({
      repoId: PAY,
      name,
      state,
      link: `https://github.com/acme/pay/milestone/${name.length.toString()}`,
      issueNumbers: Array.from({ length: issues }, (_, index) => index + 1),
    });
  }

  async function seedForge(tag: string, assetNames: string[], noForgeRelease = false) {
    await database.db.insert(schema.workForgeReleases).values({
      repoId: PAY,
      tag,
      assetNames,
      link: `https://github.com/acme/pay/releases/tag/${tag}`,
      noForgeRelease,
    });
  }

  async function seedRecord(tag: string, json: Record<string, unknown> = recordJson(tag)) {
    const parsed = parseReleaseRecord(JSON.stringify(json), tag);
    if (!parsed.ok) throw new Error("fixture record is not valid");
    await database.db.insert(schema.workReleaseRecords).values({
      repoId: PAY,
      tag,
      assetName: `record-${tag}.json`,
      size: 10,
      fetchedAt: T0,
      state: "ok",
      fields: parsed.fields,
    });
  }

  it("shows a released Release with its record, approval and links", async () => {
    const app = await releaseApp();
    await seedRelease("v2.2.1", "released");
    await seedForge("v2.2.1", ["record-v2.2.1.md", "record-v2.2.1.json"]);
    await seedRecord("v2.2.1");
    const { items } = await releases(app);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "v2.2.1",
      state: "released",
      issueCount: 6,
      link: expect.stringContaining("github.com/acme/pay") as unknown,
      forgeReleaseLink: "https://github.com/acme/pay/releases/tag/v2.2.1",
      releasePull: null,
      record: {
        kind: "ok",
        tier: "sensitive",
        approval: { kind: "approved", by: "op-login", time: "2026-02-01T10:00:00Z" },
        gaps: { total: 0 },
      },
    });
  });

  it("shows an open Release with its release pull request and the release review", async () => {
    const app = await releaseApp();
    await seedRelease("v2.3.0", "open", 2);
    await database.db.insert(schema.workPullRequests).values({
      repoId: PAY,
      number: 330,
      title: "t",
      state: "open",
      draft: false,
      headBranch: "release/2.3",
      baseBranch: "production",
      author: "a",
      checks: "pass",
      link: "https://github.com/acme/pay/pull/330",
      lastListedAt: T0,
      headSha: "B".repeat(40),
    });
    await database.db.insert(schema.workCommitStatuses).values({
      repoId: PAY,
      pullRequestNumber: 330,
      context: "factory/release-review",
      sha: "B".repeat(40),
      state: "fail",
      fetchedAt: T0,
    });
    const { items } = await releases(app);
    expect(items[0]).toMatchObject({
      state: "open",
      releasePull: {
        number: 330,
        link: "https://github.com/acme/pay/pull/330",
        checks: "pass",
        review: "fail",
      },
      record: { kind: "none", reason: "before_release" },
    });
  });

  it("shows no release review when the status is for another head sha, and no pull request when none matches", async () => {
    const app = await releaseApp();
    await seedRelease("v2.3.0", "open");
    await seedRelease("v2.4.0", "open");
    await database.db.insert(schema.workPullRequests).values({
      repoId: PAY,
      number: 330,
      title: "t",
      state: "open",
      draft: false,
      headBranch: "release/2.3",
      baseBranch: "production",
      author: "a",
      checks: "pass",
      lastListedAt: T0,
      headSha: "C".repeat(40),
    });
    await database.db.insert(schema.workCommitStatuses).values({
      repoId: PAY,
      pullRequestNumber: 330,
      context: "factory/release-review",
      sha: "B".repeat(40),
      state: "pass",
      fetchedAt: T0,
    });
    const { items } = await releases(app);
    expect(items.map((row) => [row.name, row.releasePull?.number ?? null])).toEqual([
      ["v2.4.0", null],
      ["v2.3.0", 330],
    ]);
    expect(items[1]?.releasePull?.review).toBeNull();
  });

  it("counts the gaps from the record fields and never shows gap text", async () => {
    const app = await releaseApp();
    await seedRelease("v2.2.1", "released");
    await seedForge("v2.2.1", ["r.json"]);
    await seedRecord("v2.2.1", recordWithGaps("v2.2.1"));
    const { items } = await releases(app);
    expect(items[0]?.record).toMatchObject({
      kind: "ok",
      approval: { kind: "missing" },
      gaps: {
        total: 3,
        controlsNotProven: ["CTRL-PAY-07"],
        directCommits: 1,
        approvalMissing: true,
        other: 0,
      },
    });
    expect(JSON.stringify(items)).not.toContain("SECRET");
  });

  it("shows why a Release has no record", async () => {
    const app = await releaseApp();
    await seedRelease("v1.0.0", "released");
    await seedForge("v1.0.0", ["notes.md"]);
    await seedRelease("v1.1.0", "released");
    await seedForge("v1.1.0", ["a.json", "b.json"]);
    await seedRelease("v1.2.0", "released");
    await seedRelease("v1.3.0", "released");
    await seedForge("v1.3.0", ["x.json"]);
    await database.db.insert(schema.workReleaseRecords).values([
      { repoId: PAY, tag: "v1.0.0", fetchedAt: T0, state: "no_record" },
      { repoId: PAY, tag: "v1.1.0", fetchedAt: T0, state: "more_than_one_record" },
      { repoId: PAY, tag: "v1.3.0", fetchedAt: T0, state: "not_readable", assetName: "x.json" },
    ]);
    const { items } = await releases(app);
    expect(items.map((row) => [row.name, row.record])).toEqual([
      ["v1.3.0", { kind: "none", reason: "not_readable" }],
      ["v1.2.0", { kind: "none", reason: "no_forge_release" }],
      ["v1.1.0", { kind: "none", reason: "more_than_one_record" }],
      ["v1.0.0", { kind: "none", reason: "no_record" }],
    ]);
  });

  it("shows 'module off' for a repo that does not list the release_record module", async () => {
    const app = await releaseApp(["waivers"]);
    await seedRelease("v1.0.0", "released");
    await seedForge("v1.0.0", ["notes.md"]);
    const { items } = await releases(app);
    expect(items[0]?.record).toEqual({ kind: "none", reason: "module_off" });
  });

  it("sorts by semantic version from high to low", async () => {
    const app = await releaseApp();
    for (const name of ["v2.9.0", "v2.10.0", "v10.0.0", "v2.2.1"]) {
      await seedRelease(name, "released", 1);
    }
    const { items } = await releases(app);
    expect(items.map((row) => row.name)).toEqual(["v10.0.0", "v2.10.0", "v2.9.0", "v2.2.1"]);
    const first = await releases(app, "/api/controls/releases?limit=2");
    const next = await releases(
      app,
      `/api/controls/releases?limit=2&cursor=${first.nextCursor ?? ""}`,
    );
    expect([...first.items, ...next.items].map((row) => row.name)).toEqual(
      items.map((row) => row.name),
    );
  });
});

describe("Security artefacts", () => {
  it("summarises the Risk map, the Control register and the Threat model", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, RISK_MAP, {
      tiers: { authority: 5, sensitive: 3, general: 0, inert: 1 },
      boundaries: [
        { id: "TB-1", globs: 1 },
        { id: "TB-2", globs: 2 },
      ],
    });
    await seedFile(PAY, CONTROL_REGISTER, {
      controls: ["CTRL-PAY-01", "CTRL-PAY-02", "CTRL-PAY-03", "CTRL-PAY-07"].map((id) => ({
        id,
        title: "t",
        owner: "o",
        sources: 0,
        modules: 1,
        manualChecks: 0,
      })),
    });
    await seedFile(PAY, THREAT_MODEL, {
      boundaries: ["TB-1", "TB-2"],
      threats: [
        { id: "TM-1", boundary: "TB-1", stride: [], controls: ["CTRL-PAY-01"] },
        { id: "TM-2", boundary: "TB-1", stride: [], controls: ["CTRL-PAY-02"] },
        { id: "TM-3", boundary: "TB-2", stride: [], controls: ["CTRL-PAY-03"] },
        { id: "TM-4", boundary: "TB-2", stride: [], controls: [] },
        { id: "TM-5", boundary: "TB-2", stride: [], controls: ["CTRL-OPS-09"] },
      ],
    });
    const { artefacts } = await view(app);
    expect(artefacts).toHaveLength(1);
    const [row] = artefacts;
    expect(row?.riskMap).toMatchObject({
      state: "ok",
      sha7: "abcdef0",
      fetchedAt: T0.toISOString(),
      summary: { authority: 5, sensitive: 3, general: 0, inert: 1, boundaries: 2 },
    });
    expect(row?.controlRegister.summary).toEqual({ controls: 4 });
    expect(row?.threatModel.summary).toEqual({
      boundaries: 2,
      threats: 5,
      withoutControl: ["TM-4"],
      citedNotInRegister: ["CTRL-OPS-09"],
    });
  });

  it("shows a missing file with its ref, and not_read when no step read the file", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, THREAT_MODEL, null, { state: "missing_file", sha: null });
    const { artefacts } = await view(app);
    expect(artefacts[0]?.threatModel).toMatchObject({
      state: "missing_file",
      ref: "main",
      summary: null,
    });
    expect(artefacts[0]?.riskMap.state).toBe("not_read");
  });
});

describe("The Control register list", () => {
  it("shows the status in the newest valid Release record, or none", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, CONTROL_REGISTER, {
      controls: ["CTRL-PAY-07", "CTRL-PAY-03"].map((id) => ({
        id,
        title: `title ${id}`,
        owner: "owner-login",
        sources: 2,
        modules: 1,
        manualChecks: 3,
      })),
    });
    for (const tag of ["v2.2.1", "v2.10.0"]) {
      const parsed = parseReleaseRecord(
        JSON.stringify(
          recordJson(tag, {
            controls: {
              summary: {},
              controls: [{ id: "CTRL-PAY-03", status: tag === "v2.10.0" ? "passing" : "failing" }],
            },
          }),
        ),
        tag,
      );
      if (!parsed.ok) throw new Error("fixture record is not valid");
      await database.db.insert(schema.workReleaseRecords).values({
        repoId: PAY,
        tag,
        fetchedAt: T0,
        state: "ok",
        fields: parsed.fields,
      });
    }
    const { status, body } = await get(app, "/api/controls/register");
    expect(status).toBe(200);
    const { items } = ControlsRegisterResponse.parse(body);
    expect(items.map((row) => [row.id, row.status])).toEqual([
      ["CTRL-PAY-03", { tag: "v2.10.0", status: "passing" }],
      ["CTRL-PAY-07", null],
    ]);
    expect(items[0]).toMatchObject({
      title: "title CTRL-PAY-03",
      owner: "owner-login",
      sources: 2,
      modules: 1,
      manualChecks: 3,
    });
  });

  it("pages the register", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedFile(PAY, CONTROL_REGISTER, {
      controls: Array.from({ length: 5 }, (_, index) => ({
        id: `CTRL-PAY-0${(index + 1).toString()}`,
        title: "t",
        owner: "o",
        sources: 0,
        modules: 1,
        manualChecks: 0,
      })),
    });
    const first = ControlsRegisterResponse.parse(
      (await get(app, "/api/controls/register?limit=3")).body,
    );
    const second = ControlsRegisterResponse.parse(
      (await get(app, `/api/controls/register?limit=3&cursor=${first.nextCursor ?? ""}`)).body,
    );
    expect([first.items.length, second.items.length, second.nextCursor]).toEqual([3, 2, null]);
  });
});

describe("Control modules by repo", () => {
  it("shows the profile, the modules and Control events on or off", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");
    await seedFile(PAY, CONFIG, configFields(["risk_tiers", "control_events"]));
    await seedFile(WEB, CONFIG, configFields([]));
    const { modules } = await view(app);
    expect(
      modules.map((row) => [row.repo, row.profile, row.modules.length, row.controlEvents]),
    ).toEqual(
      expect.arrayContaining([
        ["acme/pay", "regulated", 2, true],
        ["acme/web", "none", 0, false],
      ]),
    );
  });

  it("shows a controls key that is not valid, and a missing repo config", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");
    await seedFile(PAY, CONFIG, {
      mainBranch: null,
      controls: { state: "not_valid" },
      releases: null,
    });
    await seedFile(WEB, CONFIG, null, { state: "missing_file", sha: null });
    const { modules } = await view(app);
    const pay = modules.find((row) => row.repo === "acme/pay");
    const web = modules.find((row) => row.repo === "acme/web");
    expect(pay?.controlsKey).toBe("not_valid");
    expect(web).toMatchObject({ configState: "missing_file", controlsKey: null, profile: "none" });
  });
});

describe("Controls in a client scope and with repos not connected", () => {
  it("shows only the data of the client, and refuses a repo of another client", async () => {
    const app = await appFor();
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(GLOBEX, "globex", "api");
    await seedFile(PAY, CONFIG, configFields(["waivers"]));
    await seedFile(GLOBEX, CONFIG, configFields(["waivers"]));
    await seedFile(PAY, WAIVERS, { waivers: [waiver("WAIVER-1", "2027-03-01")] });
    await seedFile(GLOBEX, WAIVERS, { waivers: [waiver("WAIVER-2", "2027-03-01")] });
    expect(
      (await waivers(app, "/api/controls/waivers?client=acme")).items.map((row) => row.id),
    ).toEqual(["WAIVER-1"]);
    expect((await view(app, "/api/controls?client=acme")).modules.map((row) => row.repo)).toEqual([
      "acme/pay",
    ]);
    for (const url of [
      `/api/controls/releases?client=acme&repo=${GLOBEX}`,
      `/api/controls/waivers?client=acme&repo=${GLOBEX}`,
      `/api/controls/register?client=acme&repo=${GLOBEX}`,
      "/api/controls?client=nobody",
    ]) {
      expect((await get(app, url)).status).toBe(400);
    }
  });

  it("counts the repos with no cache rows as not complete", async () => {
    const app = await appFor({
      repos: [entry("acme/pay", "acme"), entry("acme/web", "acme"), entry("acme/docs", "acme")],
    });
    await seedRepo(PAY, "acme", "pay");
    await seedRepo(WEB, "acme", "web");
    const result = await view(app);
    expect(result.state).toBe("ok");
    expect(result.complete.incompleteRepos).toBe(1);
  });

  it("shows each Waiver ID of the events with 'register not read' when no repo is connected", async () => {
    const app = await appFor({ tokens: {}, events: [waiverUsed("acme/pay", "WAIVER-9", 4)] });
    const { items } = await waivers(app);
    expect(items).toEqual([
      expect.objectContaining({ id: "WAIVER-9", expiry: "register_not_read", uses: 1 }),
    ]);
    expect((await view(app)).state).toBe("not_connected");
  });
});
