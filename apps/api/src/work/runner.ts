import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AdapterRole, ResolvedAdapter } from "./adapters.ts";
import { contractSchemas, RELEASE_TAG_PATTERN, type ContractName } from "./contract.ts";

export const MAX_STDOUT_BYTES = 20 * 1024 * 1024;
export const MAX_STDERR_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;

export type ErrorClass =
  "auth" | "not_found" | "rate_limit" | "timeout" | "invalid_output" | "other" | "host_not_allowed";

/** The state that the status shows for each error class. */
export const ERROR_CLASS_STATE: Record<ErrorClass, string> = {
  auth: "token rejected",
  not_found: "repo not found or no access",
  rate_limit: "rate limit",
  timeout: "timeout",
  invalid_output: "invalid adapter output",
  other: "adapter error",
  host_not_allowed: "host not allowed",
};

/** The runner refuses a command that is not on the allow-list. No subprocess starts. */
export class CommandRefusedError extends Error {
  constructor(reason: string) {
    super(`command refused: ${reason}`);
    this.name = "CommandRefusedError";
  }
}

interface AllowedCommand {
  role: AdapterRole;
  contract: ContractName;
}

const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/;

/** Matches an argument list against the allow-list. Any other shape returns `undefined`. */
function matchAllowed(command: readonly string[]): AllowedCommand | undefined {
  const [group, verb, first, second, ...rest] = command;
  if (rest.length > 0) return undefined;
  const isState = (value: string | undefined, allowed: readonly string[]) =>
    value !== undefined && allowed.includes(value);

  if (
    group === "issue" &&
    verb === "list" &&
    first === "--state" &&
    isState(second, ["all", "open"])
  ) {
    return { role: "tracker", contract: "issueList" };
  }
  if (
    group === "issue" &&
    verb === "relations" &&
    first !== undefined &&
    second === undefined &&
    POSITIVE_INTEGER.test(first)
  ) {
    return { role: "tracker", contract: "issueRelations" };
  }
  if (group === "release" && verb === "list" && first === "--state" && second === "all") {
    return { role: "tracker", contract: "releaseList" };
  }
  if (
    group === "pr" &&
    verb === "list" &&
    first === "--state" &&
    isState(second, ["all", "open"])
  ) {
    return { role: "forge", contract: "prList" };
  }
  if (
    group === "pr" &&
    verb === "reviews" &&
    first !== undefined &&
    second === undefined &&
    POSITIVE_INTEGER.test(first)
  ) {
    return { role: "forge", contract: "prReviews" };
  }
  if (
    group === "release" &&
    verb === "view" &&
    first !== undefined &&
    second === undefined &&
    RELEASE_TAG_PATTERN.test(first)
  ) {
    return { role: "forge", contract: "releaseView" };
  }
  return undefined;
}

const errorObjectSchema = z.object({ error: z.string() }).loose();

/** Maps the free text of an adapter error to an error class. */
export function classifyAdapterError(text: string): ErrorClass {
  const lower = text.toLowerCase();
  if (lower.includes("http 401") || lower.includes("bad credentials")) return "auth";
  if (lower.includes("http 404") || lower.includes("could not resolve")) return "not_found";
  if (lower.includes("rate limit")) return "rate_limit";
  if (lower.includes("timed out")) return "timeout";
  return "other";
}

export interface RunnerOptions {
  /** The hosts that an adapter may call, in lower case. */
  allowedHosts: readonly string[];
  timeoutMs?: number;
  log?: { warn(message: string): void };
}

export interface AdapterRequest {
  adapter: ResolvedAdapter;
  host: string;
  /** `owner/name` */
  repo: string;
  /** The token for this host and owner. It lives in the environment of the subprocess only. */
  token: string;
  /** The adapter command without the global options, for example `["pr", "list", "--state", "open"]`. */
  command: readonly string[];
}

export type AdapterResult =
  { ok: true; data: unknown } | { ok: false; errorClass: ErrorClass; state: string };

function failure(errorClass: ErrorClass): AdapterResult {
  return { ok: false, errorClass, state: ERROR_CLASS_STATE[errorClass] };
}

interface ProcessEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    // ESRCH or EPERM (macOS, for a group that is ending): no process of the group is left to stop.
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

function runProcess(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<ProcessEnd> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = argv;
    if (file === undefined) {
      reject(new Error("empty argument list"));
      return;
    }
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let overflow = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        overflow = true;
        killGroup(child.pid);
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        overflow = true;
        killGroup(child.pid);
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Stop any process that the adapter left behind: no `gh` keeps the token.
      killGroup(child.pid);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        overflow,
      });
    });
  });
}

/**
 * The only function in Foreman that starts a subprocess. It runs one allow-listed
 * read command of an adapter, isolated, and validates the output with the contract.
 */
export async function runAdapterCommand(
  request: AdapterRequest,
  options: RunnerOptions,
): Promise<AdapterResult> {
  const allowed = matchAllowed(request.command);
  if (allowed === undefined) throw new CommandRefusedError("not on the allow-list");
  if (allowed.role !== request.adapter.role) {
    throw new CommandRefusedError(`not a ${request.adapter.role} command`);
  }
  if (!options.allowedHosts.includes(request.host.toLowerCase())) {
    return failure("host_not_allowed");
  }

  const commandText = request.command.join(" ");
  const folder = await mkdtemp(path.join(os.tmpdir(), "foreman-adapter-"));
  try {
    const home = path.join(folder, "home");
    const ghConfig = path.join(folder, "gh");
    const uvCache = path.join(folder, "uv-cache");
    await Promise.all([mkdir(home), mkdir(ghConfig), mkdir(uvCache)]);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      GH_CONFIG_DIR: ghConfig,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      UV_OFFLINE: "1",
      UV_PYTHON_DOWNLOADS: "never",
      UV_CACHE_DIR: uvCache,
      [request.adapter.tokenEnv]: request.token,
    };
    const end = await runProcess(
      [
        "uv",
        "run",
        request.adapter.command,
        "--host",
        request.host,
        "--repo",
        request.repo,
        ...request.command,
      ],
      folder,
      env,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (end.timedOut) return failure("timeout");
    if (end.overflow || end.signal !== null) return failure("other");
    if (end.code === 1) {
      try {
        const parsed = errorObjectSchema.parse(JSON.parse(end.stderr));
        return failure(classifyAdapterError(parsed.error));
      } catch {
        return failure("other");
      }
    }
    if (end.code !== 0) return failure("other");

    let json: unknown;
    try {
      json = JSON.parse(end.stdout);
    } catch {
      options.log?.warn(`invalid adapter output for "${commandText}"`);
      return failure("invalid_output");
    }
    const parsed = contractSchemas[allowed.contract].safeParse(json);
    if (!parsed.success) {
      options.log?.warn(`invalid adapter output for "${commandText}"`);
      return failure("invalid_output");
    }
    return { ok: true, data: parsed.data };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
