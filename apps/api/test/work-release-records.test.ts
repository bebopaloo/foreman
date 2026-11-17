import { schema } from "@foreman/db";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runReindex } from "../src/reindex.ts";
import { runFetch } from "../src/work/fetch.ts";
import { repoId } from "../src/work/repo-list.ts";
import { openTestDatabase } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import { assetAnswer, recordJson, recordWithGaps } from "./release-record-fixtures.ts";
import {
  adapterEntry,
  forgeRelease,
  forgeScenario,
  installAdapters,
  release,
  TOKEN,
  trackerScenario,
  writeTokens,
} from "./work-fetch-fixtures.ts";

// Each fetch runs one real `uv run` subprocess per adapter call, and a test makes
// up to five fetches of several calls. A cold `uv` start takes 0.2 to 0.5 s when
// other test runs share the machine, so such a test can pass the 5 s default of
// Vitest. 30 s is well above the worst time seen under load. A hung adapter call
// still ends at its own 20 s timeout, so a real hang still fails.
vi.setConfig({ testTimeout: 30_000 });

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases, work_release_records, work_fetch_runs`,
  );
});

const REPO = repoId("github.com", "acme", "app");
const T0 = new Date("2026-03-01T10:00:00Z");
const hours = (count: number) => new Date(T0.getTime() + count * 3_600_000);

async function setup(
  releases: Record<string, Record<string, unknown>>,
  assets: Record<string, unknown> = {},
) {
  const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme", adapterEntry)] });
  const adapters = await installAdapters(claudeDir);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
  await adapters.setScenario(
    "tracker",
    trackerScenario(
      [],
      [],
      Object.keys(releases).map((tag) => release(tag, "released")),
    ),
  );
  const forge = forgeScenario([], [], {}, releases);
  for (const [key, answer] of Object.entries(assets)) forge[key] = { ok: answer };
  await adapters.setScenario("forge", forge);
  const fetchAt = (now: Date) =>
    runFetch({
      db: database.db,
      claudeDir,
      allowedHosts: ["github.com"],
      timeoutMs: 20_000,
      now: () => now,
      tokenSource: tokensFile,
    });
  return { claudeDir, adapters, fetchAt, forge };
}

async function records() {
  return database.db
    .select()
    .from(schema.workReleaseRecords)
    .orderBy(asc(schema.workReleaseRecords.tag));
}

describe("the Release record step", () => {
  it("reads the one .json asset and caches the parsed fields, with no gap text", async () => {
    const env = await setup(
      {
        "v2.2.1": forgeRelease("v2.2.1", { assets: ["record-v2.2.1.md", "record-v2.2.1.json"] }),
        "v2.2.2": forgeRelease("v2.2.2", { assets: ["record-v2.2.2.json"] }),
      },
      {
        "release asset v2.2.1 record-v2.2.1.json": assetAnswer(
          "v2.2.1",
          "record-v2.2.1.json",
          recordJson("v2.2.1"),
        ),
        "release asset v2.2.2 record-v2.2.2.json": assetAnswer(
          "v2.2.2",
          "record-v2.2.2.json",
          recordWithGaps("v2.2.2"),
        ),
      },
    );
    await env.fetchAt(T0);
    const rows = await records();
    expect(rows.map((row) => [row.repoId, row.tag, row.assetName, row.state])).toEqual([
      [REPO, "v2.2.1", "record-v2.2.1.json", "ok"],
      [REPO, "v2.2.2", "record-v2.2.2.json", "ok"],
    ]);
    expect(rows[0]).toMatchObject({ fetchedAt: T0, errorClass: null });
    expect(rows[0]?.size).toBeGreaterThan(0);
    expect(rows[0]?.fields).toMatchObject({ tier: "sensitive", gaps: { total: 0 } });
    expect(rows[1]?.fields).toMatchObject({ gaps: { total: 3, controlsNotProven: 1 } });
    expect(JSON.stringify(rows)).not.toContain("SECRET");
  });

  it("makes no call for no .json asset or for two, and no row for no forge release", async () => {
    const env = await setup({
      "v1.0.0": forgeRelease("v1.0.0", { assets: ["app.tgz"] }),
      "v1.1.0": forgeRelease("v1.1.0", { assets: ["a.json", "b.json"] }),
    });
    env.forge["release view v1.2.0"] = { error: "HTTP 404 Not Found" };
    await env.adapters.setScenario("forge", env.forge);
    await env.adapters.setScenario(
      "tracker",
      trackerScenario(
        [],
        [],
        ["v1.0.0", "v1.1.0", "v1.2.0"].map((tag) => release(tag, "released")),
      ),
    );
    await env.fetchAt(T0);
    expect((await records()).map((row) => [row.tag, row.state, row.assetName])).toEqual([
      ["v1.0.0", "no_record", null],
      ["v1.1.0", "more_than_one_record", null],
    ]);
    expect(
      (await env.adapters.calls("forge")).filter((c) => c.startsWith("release asset")),
    ).toEqual([]);
  });

  it.each([
    ["not JSON", "{nope"],
    ["a record that fails the schema", { release: { name: "v3.0.0" } }],
    ["a record for another tag", recordJson("v9.9.9")],
  ])(
    "stores 'not_readable' with no fields for %s, and does not read it again",
    async (_n, body) => {
      const env = await setup(
        { "v3.0.0": forgeRelease("v3.0.0", { assets: ["r.json"] }) },
        { "release asset v3.0.0 r.json": assetAnswer("v3.0.0", "r.json", body) },
      );
      await env.fetchAt(T0);
      expect(await records()).toMatchObject([
        { tag: "v3.0.0", state: "not_readable", fields: null },
      ]);
      expect(await database.db.select().from(schema.workRepos)).toMatchObject([
        { forgeState: "ok" },
      ]);
      await env.adapters.clearCalls();
      await env.fetchAt(hours(25));
      expect(await env.adapters.calls("forge")).not.toContain("release asset v3.0.0 r.json");
    },
  );

  it.each([
    ["release not found: v3.0.0", "missing_tag", "ok"],
    ["asset not found: r.json in release v3.0.0", "missing_asset", "ok"],
    ["something broke", "failed", "partial"],
  ])("maps the error %j to the state %s", async (message, state, forgeState) => {
    const env = await setup({ "v3.0.0": forgeRelease("v3.0.0", { assets: ["r.json"] }) });
    env.forge["release asset v3.0.0 r.json"] = { error: message };
    await env.adapters.setScenario("forge", env.forge);
    await env.fetchAt(T0);
    expect(await records()).toMatchObject([
      { tag: "v3.0.0", state, errorClass: state === "failed" ? "other" : state },
    ]);
    expect((await database.db.select().from(schema.workRepos))[0]?.forgeState).toBe(forgeState);
  });

  it("tries again after a failure", async () => {
    const env = await setup({ "v3.0.0": forgeRelease("v3.0.0", { assets: ["r.json"] }) });
    env.forge["release asset v3.0.0 r.json"] = { error: "something broke" };
    await env.adapters.setScenario("forge", env.forge);
    await env.fetchAt(T0);
    env.forge["release asset v3.0.0 r.json"] = {
      ok: assetAnswer("v3.0.0", "r.json", recordJson("v3.0.0")),
    };
    await env.adapters.setScenario("forge", env.forge);
    await env.fetchAt(hours(1));
    expect(await records()).toMatchObject([{ state: "ok", errorClass: null }]);
  });
});

describe("a Release record is read once", () => {
  it("skips a cached valid record in the next fetch and in a full fetch, and reads it after a reindex", async () => {
    const env = await setup(
      { "v2.2.1": forgeRelease("v2.2.1", { assets: ["record-v2.2.1.json"] }) },
      {
        "release asset v2.2.1 record-v2.2.1.json": assetAnswer(
          "v2.2.1",
          "record-v2.2.1.json",
          recordJson("v2.2.1"),
        ),
      },
    );
    const call = "release asset v2.2.1 record-v2.2.1.json";
    await env.fetchAt(T0);
    expect(await env.adapters.calls("forge")).toContain(call);

    await env.adapters.clearCalls();
    await env.fetchAt(hours(1));
    expect(await env.adapters.calls("forge")).not.toContain(call);

    await env.adapters.clearCalls();
    await env.fetchAt(hours(25));
    expect(await env.adapters.calls("forge")).not.toContain("release view v2.2.1");
    expect(await env.adapters.calls("forge")).not.toContain(call);

    await runReindex({
      db: database.db,
      claudeDir: env.claudeDir,
      dataDir: env.claudeDir,
      log: { info: () => undefined, warn: () => undefined },
    });
    expect(await records()).toEqual([]);
    await env.adapters.clearCalls();
    await env.fetchAt(hours(26));
    const calls = (await env.adapters.calls("forge")).filter((c) => c === call);
    expect(calls).toEqual([call]);
    expect(await records()).toMatchObject([{ state: "ok" }]);
  });
});
