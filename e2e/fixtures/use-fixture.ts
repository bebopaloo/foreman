import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import { adapterFiles, type AdapterData } from "./adapter/index.ts";
import { FIXTURE_SETS, type FixtureName } from "./sets.ts";
import { clearUsageIndex } from "./usage-seed.ts";
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

interface UsageStatus {
  state?: unknown;
  dataAsOf?: unknown;
}

async function usageStatus(apiPort: string): Promise<UsageStatus> {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/usage/status`);
  return (await response.json()) as UsageStatus;
}

async function waitForUsageIdle(apiPort: string): Promise<UsageStatus> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = await usageStatus(apiPort);
    if (status.state !== "running") return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The usage refresh did not end.");
}

/** Reads the transcripts of the live Claude folder into the Usage index, and waits until it ends. */
async function refreshUsage(apiPort: string): Promise<void> {
  await waitForUsageIdle(apiPort);
  const before = (await usageStatus(apiPort)).dataAsOf;
  await fetch(`http://127.0.0.1:${apiPort}/api/usage/refresh`, {
    method: "POST",
  });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = await usageStatus(apiPort);
    if (status.state === "idle" && status.dataAsOf !== null && status.dataAsOf !== before) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The usage refresh did not end.");
}

/** Starts a real fetch through the refresh route, and waits until it ends. */
async function refreshWork(apiPort: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/work/refresh`, {
    method: "POST",
    headers: { origin: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? ""}` },
  });
  if (response.status !== 202)
    throw new Error(`The refresh was refused: ${String(response.status)}.`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitForFetchIdle(apiPort);
}

const INSTALLED_PLUGINS = "plugins/installed_plugins.json";

function mergeInstalled(first: string, second: string): string {
  const plugins = (text: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("plugins" in parsed)) return {};
    const value = parsed.plugins;
    return typeof value === "object" && value !== null ? { ...value } : {};
  };
  return JSON.stringify({ version: 2, plugins: { ...plugins(first), ...plugins(second) } });
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
    usage?: boolean;
    work?: Parameters<typeof seedWorkCache>[1];
    tokenOwners?: readonly string[];
    adapter?: AdapterData;
  } = FIXTURE_SETS[name];
  await waitForFetchIdle(apiPort);
  if (set.usage === true) {
    await waitForUsageIdle(apiPort);
    await clearUsageIndex(databaseUrl);
  }
  await rm(LIVE_CLAUDE_DIR, { recursive: true, force: true });
  await mkdir(LIVE_CLAUDE_DIR, { recursive: true });
  const files = {
    ...set.files(now),
    ...(set.adapter === undefined ? {} : adapterFiles(set.adapter)),
  };
  const own = set.files(now)[INSTALLED_PLUGINS];
  if (own !== undefined && set.adapter !== undefined) {
    // The set and the synthetic adapter both install plugins: one file lists them all.
    const adapterInstalled = adapterFiles(set.adapter)[INSTALLED_PLUGINS] ?? "{}";
    files[INSTALLED_PLUGINS] = mergeInstalled(own, adapterInstalled);
  }
  for (const [relative, content] of Object.entries(files)) {
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
  if (set.adapter !== undefined) await refreshWork(apiPort);
  if (set.usage === true) await refreshUsage(apiPort);
}
