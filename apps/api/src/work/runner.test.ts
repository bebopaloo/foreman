import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedAdapter } from "./adapters.ts";
import {
  classifyAdapterError,
  CommandRefusedError,
  runAdapterCommand,
  type AdapterRequest,
  type RunnerOptions,
} from "./runner.ts";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "adapter",
  "synthetic_adapter.py",
);

const TOKEN = "github_pat_synthetic_value";
const options: RunnerOptions = { allowedHosts: ["github.com"], timeoutMs: 20_000 };

let folder: string;
let adapter: ResolvedAdapter;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "foreman-runner-test-"));
  await copyFile(SCRIPT, path.join(folder, "synthetic_adapter.py"));
  adapter = {
    role: "forge",
    pluginDir: folder,
    command: path.join(folder, "synthetic_adapter.py"),
    tokenEnv: "SYNTH_TOKEN",
    tokenPrefix: "github_pat_",
  };
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function control(value: Record<string, unknown>) {
  await writeFile(path.join(folder, "control.json"), JSON.stringify(value));
}

async function record() {
  return JSON.parse(await readFile(path.join(folder, "record.json"), "utf8")) as {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
  };
}

function request(command: string[], over: Partial<AdapterRequest> = {}): AdapterRequest {
  return { adapter, host: "github.com", repo: "acme/app", token: TOKEN, command, ...over };
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

const pr = {
  number: 3,
  url: "https://github.com/acme/app/pull/3",
  title: "A title",
  state: "open",
  draft: false,
  head: "a",
  base: "b",
  author: "someone",
  checks: "success",
  labels: [],
};

describe("the command allow-list", () => {
  it.each([
    ["pr", "merge", "12"],
    ["issue", "state", "3", "--set", "DONE"],
    ["pr", "list", "--state", "closed"],
    ["pr", "list", "--state", "open", "--json"],
    ["pr", "reviews", "0"],
    ["pr", "reviews", "1; rm -rf"],
    ["release", "view", "../v1.0.0"],
    ["issue", "list"],
    [],
  ])("refuses %j and starts no subprocess", async (...command) => {
    await expect(runAdapterCommand(request(command), options)).rejects.toBeInstanceOf(
      CommandRefusedError,
    );
    expect(await exists(path.join(folder, "record.json"))).toBe(false);
  });

  it("refuses a command of the other role", async () => {
    await expect(
      runAdapterCommand(request(["issue", "list", "--state", "all"]), options),
    ).rejects.toBeInstanceOf(CommandRefusedError);
    expect(await exists(path.join(folder, "record.json"))).toBe(false);
  });
});

describe("the host allow-list", () => {
  it("starts no subprocess for a host that is not allowed", async () => {
    const result = await runAdapterCommand(
      request(["pr", "list", "--state", "open"], { host: "git.example.com" }),
      options,
    );
    expect(result).toEqual({
      ok: false,
      errorClass: "host_not_allowed",
      state: "host not allowed",
    });
    expect(await exists(path.join(folder, "record.json"))).toBe(false);
  });
});

describe("isolation", () => {
  it("runs the adapter with its arguments, an empty folder and a small environment", async () => {
    await control({ stdout: JSON.stringify([pr]) });
    const result = await runAdapterCommand(request(["pr", "list", "--state", "open"]), options);
    expect(result).toEqual({ ok: true, data: [pr] });

    const call = await record();
    expect(call.argv).toEqual([
      "--host",
      "github.com",
      "--repo",
      "acme/app",
      "pr",
      "list",
      "--state",
      "open",
    ]);
    const cwd = await realpathOf(call.cwd);
    expect(cwd.startsWith(await realpathOf(os.tmpdir()))).toBe(true);
    expect(spawnSync("git", ["-C", path.dirname(cwd), "rev-parse"]).status).not.toBe(0);
    expect(await exists(cwd)).toBe(false);

    expect(call.env.SYNTH_TOKEN).toBe(TOKEN);
    expect(Object.keys(call.env).some((name) => name.startsWith("FACTORY_"))).toBe(false);
    const declared = [
      "GH_CONFIG_DIR",
      "GH_NO_UPDATE_NOTIFIER",
      "GH_PROMPT_DISABLED",
      "HOME",
      "NO_COLOR",
      "PATH",
      "SYNTH_TOKEN",
      "UV_CACHE_DIR",
      "UV_OFFLINE",
      "UV_PYTHON_DOWNLOADS",
    ];
    // uv, the shell and the OS add a few names of their own to the child.
    const added = [
      "UV",
      "UV_RUN_RECURSION_DEPTH",
      "LC_CTYPE",
      "__CF_USER_TEXT_ENCODING",
      "PWD",
      "SHLVL",
      "_",
    ];
    const names = Object.keys(call.env);
    expect(names.filter((name) => ![...declared, ...added].includes(name))).toEqual([]);
    expect(declared.filter((name) => !names.includes(name))).toEqual([]);
    expect(call.env.GH_PROMPT_DISABLED).toBe("1");
    expect(call.env.UV_OFFLINE).toBe("1");
    expect(call.env.UV_PYTHON_DOWNLOADS).toBe("never");
  });

  it("passes no variable of the API process to the adapter", async () => {
    process.env.FACTORY_SYNTHETIC = "1";
    process.env.SOME_OTHER_SECRET = "x";
    try {
      await control({ stdout: "[]" });
      await runAdapterCommand(request(["pr", "list", "--state", "all"]), options);
    } finally {
      delete process.env.FACTORY_SYNTHETIC;
      delete process.env.SOME_OTHER_SECRET;
    }
    const call = await record();
    expect(call.env.FACTORY_SYNTHETIC).toBeUndefined();
    expect(call.env.SOME_OTHER_SECRET).toBeUndefined();
  });
});

async function realpathOf(value: string) {
  const { realpath } = await import("node:fs/promises");
  return realpath(value).catch(() => value);
}

describe("a slow adapter", () => {
  it("stops the whole process group and ends with the state timeout", async () => {
    await control({ hang: true });
    const result = await runAdapterCommand(request(["pr", "list", "--state", "all"]), {
      ...options,
      timeoutMs: 1500,
    });
    expect(result).toEqual({ ok: false, errorClass: "timeout", state: "timeout" });

    const call = await record();
    expect(await exists(call.cwd)).toBe(false);
    const childPid = Number(await readFile(path.join(folder, "child.pid"), "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});

describe("output that breaks the contract", () => {
  it.each([
    ["an unknown key", [{ ...pr, extra: 1 }]],
    ["checks set to green", [{ ...pr, checks: "green" }]],
    ["no JSON", "not json"],
  ])("rejects %s and logs the command, not the output", async (_name, output) => {
    await control({ stdout: typeof output === "string" ? output : JSON.stringify(output) });
    const logged: string[] = [];
    const result = await runAdapterCommand(request(["pr", "list", "--state", "all"]), {
      ...options,
      log: {
        warn: (message) => {
          logged.push(message);
        },
      },
    });
    expect(result).toEqual({
      ok: false,
      errorClass: "invalid_output",
      state: "invalid adapter output",
    });
    expect(logged).toEqual(['invalid adapter output for "pr list --state all"']);
  });
});

describe("error classes", () => {
  it.each([
    ["HTTP 401: Bad credentials", "auth"],
    ["HTTP 404: Not Found", "not_found"],
    ["API rate limit exceeded", "rate_limit"],
    ["gh timed out after 120 s", "timeout"],
    ["something else", "other"],
  ])("maps %j to %s", async (text, errorClass) => {
    expect(classifyAdapterError(text)).toBe(errorClass);
    await control({ stderr: JSON.stringify({ error: text }), exit: 1 });
    const result = await runAdapterCommand(request(["pr", "reviews", "5"]), options);
    expect(result).toMatchObject({ ok: false, errorClass });
  });

  it.each([
    ["an exit code of 2", { stderr: JSON.stringify({ error: "HTTP 401" }), exit: 2 }],
    ["standard error that is not an error object", { stderr: "HTTP 401", exit: 1 }],
    ["an error that is not text", { stderr: JSON.stringify({ error: 4 }), exit: 1 }],
  ])("maps %s to other", async (_name, controlValue) => {
    await control(controlValue);
    const result = await runAdapterCommand(request(["pr", "reviews", "5"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "other" });
  });

  it("maps an adapter that ends by a signal to other", async () => {
    await control({ signal: true });
    const result = await runAdapterCommand(request(["pr", "reviews", "5"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "other" });
  });

  it.each([
    ["more than 20 MB on standard output", { stdout_bytes: 21 * 1024 * 1024 }],
    ["more than 64 KB on standard error", { stderr_bytes: 65 * 1024, exit: 1 }],
  ])("maps %s to other and stops the call", async (_name, controlValue) => {
    await control(controlValue);
    const result = await runAdapterCommand(request(["pr", "reviews", "5"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "other" });
  });
});
