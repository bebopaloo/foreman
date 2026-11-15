import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { repoId } from "../src/work/repo-list.ts";
import { runFetch } from "../src/work/fetch.ts";
import { openTestDatabase } from "./database.ts";
import { entry, makeClaudeDir } from "./repo-list-fixtures.ts";
import {
  adapterEntry,
  BODY_TEXT,
  forgeScenario,
  installAdapters,
  issue,
  pull,
  release,
  type Scenario,
  TOKEN,
  trackerScenario,
  writeTokens,
} from "./work-fetch-fixtures.ts";

let database: Awaited<ReturnType<typeof openTestDatabase>>;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table work_repos, work_issues, work_pull_requests, work_reviews, work_releases, work_forge_releases, work_fetch_runs`,
  );
});

async function fetchAndCollectLog(forge: Scenario, trackerOver: Scenario = {}) {
  const claudeDir = await makeClaudeDir({ repos: [entry("acme/app", "acme", adapterEntry)] });
  const adapters = await installAdapters(claudeDir);
  const tokensFile = await writeTokens(claudeDir, { "github.com/acme": TOKEN });
  await adapters.setScenario("tracker", {
    ...trackerScenario(
      [issue(1, { title: "Secret client plan", author: "client-login", labels: ["client-label"] })],
      [issue(1)],
      [release("v1.0.0", "open", [1])],
    ),
    ...trackerOver,
  });
  await adapters.setScenario("forge", forge);
  const lines: string[] = [];
  await runFetch({
    db: database.db,
    claudeDir,
    tokensFile,
    allowedHosts: ["github.com"],
    timeoutMs: 20_000,
    log: {
      info: (message) => lines.push(message),
      warn: (message) => lines.push(message),
    },
  });
  return lines;
}

describe("the log of a fetch", () => {
  it("holds the repo ID, counts, a duration and an error class, and no work data", async () => {
    const lines = await fetchAndCollectLog({
      ...forgeScenario(
        [pull(4, { title: "Secret pull title", head: "secret-branch", author: "client-login" })],
        [pull(4)],
      ),
      "pr list --state all": { error: "HTTP 404 Not Found secret-adapter-output" },
      "pr list --state open": { error: "HTTP 404 Not Found secret-adapter-output" },
    });
    const text = lines.join("\n");
    expect(text).toContain(repoId("github.com", "acme", "app"));
    expect(text).toMatch(/calls=\d+/);
    expect(text).toMatch(/durationMs=\d+/);
    expect(text).toContain("forge_error=not_found");
    for (const forbidden of [
      TOKEN,
      "github_pat",
      "Secret client plan",
      "Secret pull title",
      "client-login",
      "client-label",
      "secret-branch",
      "secret-adapter-output",
      BODY_TEXT,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("names the command, without a number, when the output is invalid", async () => {
    const lines = await fetchAndCollectLog(forgeScenario([], []), {
      "issue relations 1": { ok: "client-login" },
    });
    expect(lines).toContain('invalid adapter output for "issue relations"');
    expect(lines.join("\n")).not.toContain("client-login");
  });
});
