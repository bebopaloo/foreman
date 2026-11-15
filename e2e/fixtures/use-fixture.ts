import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import { FIXTURE_SETS, type FixtureName } from "./sets.ts";
import { seedWorkCache } from "./work-seed.ts";

/**
 * The Claude folder that the e2e API reads (`FOREMAN_CLAUDE_DIR`). `playwright.config.ts` points the
 * API here. The folder holds the files of one fixture set at a time, so the tests run one at a time.
 */
export const LIVE_CLAUDE_DIR = path.join(import.meta.dirname, "claude");

/** The tokens file that the e2e API reads (`FOREMAN_TOKENS_FILE`). Its tokens are synthetic. */
export const LIVE_TOKENS_FILE = path.join(import.meta.dirname, "tokens");

const DEV_ONLY = "Fixture sets need the dev servers that Playwright starts. E2E_BASE_URL is set.";

async function waitForFetchIdle(apiPort: string): Promise<void> {
  // The API runs one fetch at start-up. It must end first, or it can overwrite the seeded cache.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/work/status`);
    const body = (await response.json()) as { state?: unknown };
    if (body.state !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The start-up fetch did not end.");
}

/**
 * Loads a named fixture set: writes its files into the live Claude folder and replaces the Work cache
 * of the e2e database. Call it first in each test, before `page.goto`. The API reads the folder on each
 * request, so it needs no restart.
 */
export async function useFixture(name: FixtureName, now: Date = new Date()): Promise<void> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  const apiPort = process.env.E2E_API_PORT;
  test.skip(databaseUrl === undefined || apiPort === undefined, DEV_ONLY);
  if (databaseUrl === undefined || apiPort === undefined) return;

  const set: {
    files(now: Date): Record<string, string>;
    work?: Parameters<typeof seedWorkCache>[1];
    tokenOwners?: readonly string[];
  } = FIXTURE_SETS[name];
  await waitForFetchIdle(apiPort);
  await rm(LIVE_CLAUDE_DIR, { recursive: true, force: true });
  await mkdir(LIVE_CLAUDE_DIR, { recursive: true });
  for (const [relative, content] of Object.entries(set.files(now))) {
    const file = path.join(LIVE_CLAUDE_DIR, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await writeFile(
    LIVE_TOKENS_FILE,
    JSON.stringify(
      Object.fromEntries((set.tokenOwners ?? []).map((owner) => [owner, "synthetic-token"])),
    ),
  );
  await seedWorkCache(databaseUrl, set.work, now);
}
