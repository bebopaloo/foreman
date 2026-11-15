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

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("the status command", () => {
  const statusOutput = {
    sha: SHA_A,
    context: "factory/machine-gate",
    state: "pass",
    description: "",
  };

  it.each(["factory/machine-gate", "factory/release-review"])(
    "accepts status get for %s",
    async (context) => {
      await control({ stdout: JSON.stringify({ ...statusOutput, context }) });
      const result = await runAdapterCommand(request(["status", "get", SHA_A, context]), options);
      expect(result).toMatchObject({ ok: true, data: { state: "pass", context } });
    },
  );

  it.each([
    ["a short sha", ["status", "get", "abc123", "factory/machine-gate"]],
    ["another context", ["status", "get", SHA_A, "factory/other"]],
    ["status set", ["status", "set", SHA_A, "factory/machine-gate", "pass"]],
    ["an extra argument", ["status", "get", SHA_A, "factory/machine-gate", "x"]],
    ["an upper case sha", ["status", "get", SHA_A.toUpperCase(), "factory/machine-gate"]],
  ])("refuses %s and starts no subprocess", async (_name, command) => {
    await expect(runAdapterCommand(request(command), options)).rejects.toBeInstanceOf(
      CommandRefusedError,
    );
    expect(await exists(path.join(folder, "record.json"))).toBe(false);
  });

  it.each([
    ["another sha", { sha: SHA_B }],
    ["another context", { context: "factory/release-review" }],
    ["the state green", { state: "green" }],
    ["an unknown key", { extra: 1 }],
  ])("rejects output with %s as invalid_output", async (_name, over) => {
    await control({ stdout: JSON.stringify({ ...statusOutput, ...over }) });
    const result = await runAdapterCommand(
      request(["status", "get", SHA_A, "factory/machine-gate"]),
      options,
    );
    expect(result).toEqual({
      ok: false,
      errorClass: "invalid_output",
      state: "invalid adapter output",
    });
  });

  it("refuses pr list output in which only some pull requests have a head_sha", async () => {
    await control({
      stdout: JSON.stringify([
        { ...pr, head_sha: SHA_A },
        { ...pr, number: 4 },
      ]),
    });
    const result = await runAdapterCommand(request(["pr", "list", "--state", "all"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_output" });
  });
});

describe("the forge file commands", () => {
  const FILE = "_context/controls/waivers.toml";
  const repoOutput = {
    host: "github.com",
    owner: "acme",
    name: "app",
    url: "https://github.com/acme/app",
    default_branch: "main",
  };
  const fileOutput = { path: FILE, ref: "main", sha: SHA_A, size: 5, content: "hello" };
  const assetOutput = { tag: "v1.2.0", name: "record-v1.2.0.json", size: 2, content: "{}" };

  it.each([
    ["repo", ["repo"], repoOutput],
    ["file get", ["file", "get", FILE, "--ref", "main"], fileOutput],
    ["release asset", ["release", "asset", "v1.2.0", "record-v1.2.0.json"], assetOutput],
  ])("accepts %s", async (_name, command, output) => {
    await control({ stdout: JSON.stringify(output) });
    const result = await runAdapterCommand(request(command), options);
    expect(result).toEqual({ ok: true, data: output });
    expect((await record()).argv.slice(-command.length)).toEqual(command);
  });

  it.each([
    ".claude/factory.json",
    "_context/controls/risk-map.toml",
    "_context/controls/controls.toml",
    "_context/controls/waivers.toml",
    "_context/threat-model.md",
    ".claude/rules/fastify-api.md",
  ])("accepts the path %s", async (file) => {
    await control({ stdout: JSON.stringify({ ...fileOutput, path: file }) });
    const result = await runAdapterCommand(
      request(["file", "get", file, "--ref", "main"]),
      options,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it.each([
    ["repo --json", ["repo", "--json"]],
    ["a path that is not listed", ["file", "get", ".env", "--ref", "main"]],
    ["a path with ..", ["file", "get", "_context/controls/../../.env", "--ref", "main"]],
    ["a leading slash", ["file", "get", "/_context/threat-model.md", "--ref", "main"]],
    ["a backslash", ["file", "get", "_context\\threat-model.md", "--ref", "main"]],
    ["a rule path with ..", ["file", "get", ".claude/rules/../settings.json", "--ref", "main"]],
    [
      "a rule file with an option as the ref",
      ["file", "get", ".claude/rules/coding.md", "--ref", "--upload-pack"],
    ],
    ["a rule name with a capital", ["file", "get", ".claude/rules/Api.md", "--ref", "main"]],
    ["a rule name with a folder", ["file", "get", ".claude/rules/a/b.md", "--ref", "main"]],
    ["a rule name that starts with -", ["file", "get", ".claude/rules/-a.md", "--ref", "main"]],
    ["a ref that starts with -", ["file", "get", FILE, "--ref", "-x"]],
    ["a ref with ..", ["file", "get", FILE, "--ref", "a..b"]],
    ["an empty ref", ["file", "get", FILE, "--ref", ""]],
    ["no --ref option", ["file", "get", FILE, "main"]],
    ["no ref", ["file", "get", FILE]],
    ["an extra argument", ["file", "get", FILE, "--ref", "main", "x"]],
    ["another file verb", ["file", "put", FILE, "--ref", "main"]],
    ["a name that is not json", ["release", "asset", "v1.2.0", "notes.md"]],
    ["a name with ..", ["release", "asset", "v1.2.0", "../x.json"]],
    ["a name that starts with a dot", ["release", "asset", "v1.2.0", ".x.json"]],
    ["a tag that is not a release tag", ["release", "asset", "main", "r.json"]],
    ["no name", ["release", "asset", "v1.2.0"]],
    ["an extra argument on release asset", ["release", "asset", "v1.2.0", "r.json", "x"]],
  ])("refuses %s and starts no subprocess", async (_name, command) => {
    await expect(runAdapterCommand(request(command), options)).rejects.toBeInstanceOf(
      CommandRefusedError,
    );
    expect(await exists(path.join(folder, "record.json"))).toBe(false);
  });

  it("refuses the commands for a tracker adapter", async () => {
    const tracker = { ...adapter, role: "tracker" as const };
    await expect(
      runAdapterCommand(request(["repo"], { adapter: tracker }), options),
    ).rejects.toBeInstanceOf(CommandRefusedError);
  });

  it.each(["trunk", "release/1.2", "feature_x+1", "v1.2.0"])("accepts the ref %s", async (ref) => {
    await control({ stdout: JSON.stringify({ ...fileOutput, ref }) });
    const result = await runAdapterCommand(request(["file", "get", FILE, "--ref", ref]), options);
    expect(result).toMatchObject({ ok: true });
  });

  it.each([
    ["file not found: x at main", "missing_file", "missing file"],
    ["ref not found: main", "missing_ref", "missing ref"],
    ["release not found: v1.2.0", "missing_tag", "missing tag"],
    ["asset not found: r.json in release v1.2.0", "missing_asset", "missing asset"],
    ["HTTP 401: Bad credentials", "auth", "token rejected"],
    ["something else", "other", "adapter error"],
  ])("maps the error %j to %s", async (text, errorClass, state) => {
    for (const command of [
      ["file", "get", FILE, "--ref", "main"],
      ["release", "asset", "v1.2.0", "r.json"],
    ]) {
      await control({ stderr: JSON.stringify({ error: text }), exit: 1 });
      const logged: string[] = [];
      const result = await runAdapterCommand(request(command), {
        ...options,
        log: { warn: (message) => logged.push(message) },
      });
      expect(result).toEqual({ ok: false, errorClass, state });
      expect(logged.join()).not.toContain(text);
    }
  });

  it("maps a prefix only at the start of the message", async () => {
    await control({ stderr: JSON.stringify({ error: "x: file not found: y" }), exit: 1 });
    const result = await runAdapterCommand(
      request(["file", "get", FILE, "--ref", "main"]),
      options,
    );
    expect(result).toMatchObject({ ok: false, errorClass: "other" });
  });

  it("does not map the prefixes for another command", async () => {
    await control({ stderr: JSON.stringify({ error: "file not found: x" }), exit: 1 });
    const result = await runAdapterCommand(request(["pr", "reviews", "5"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "other" });
  });

  it.each([
    ["a path that differs", { path: "_context/controls/risk-map.toml" }],
    ["a ref that differs", { ref: "develop" }],
    ["a short sha", { sha: "abc123" }],
    ["an upper case sha", { sha: SHA_A.toUpperCase() }],
    ["an unknown key", { extra: 1 }],
    ["a size of 2000000", { size: 2_000_000 }],
    ["a negative size", { size: -1 }],
    ["a size that is not whole", { size: 1.5 }],
    ["content over 1048576 bytes", { size: 5, content: "x".repeat(1_048_577) }],
    ["content that is not text", { content: 4 }],
  ])("rejects file get output with %s", async (_name, over) => {
    await control({ stdout: JSON.stringify({ ...fileOutput, ...over }) });
    const logged: string[] = [];
    const result = await runAdapterCommand(request(["file", "get", FILE, "--ref", "main"]), {
      ...options,
      log: { warn: (message) => logged.push(message) },
    });
    expect(result).toEqual({
      ok: false,
      errorClass: "invalid_output",
      state: "invalid adapter output",
    });
    expect(logged).toEqual(['invalid adapter output for "file get"']);
  });

  it.each([
    ["a size of 2000000", { size: 2_000_000 }],
    ["content over 1048576 bytes", { size: 5, content: "x".repeat(1_048_577) }],
  ])("gives too_large for a Repo rule file with %s", async (_name, over) => {
    const rule = ".claude/rules/coding.md";
    await control({ stdout: JSON.stringify({ ...fileOutput, path: rule, ...over }) });
    const result = await runAdapterCommand(
      request(["file", "get", rule, "--ref", "main"]),
      options,
    );
    expect(result).toEqual({ ok: false, errorClass: "too_large", state: "file too large" });
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["a short sha", { sha: "abc123" }],
    ["a size that is not whole", { size: 1.5 }],
  ])("keeps invalid_output for a Repo rule file with %s", async (_name, over) => {
    const rule = ".claude/rules/coding.md";
    await control({ stdout: JSON.stringify({ ...fileOutput, path: rule, ...over }) });
    const result = await runAdapterCommand(
      request(["file", "get", rule, "--ref", "main"]),
      options,
    );
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_output" });
  });

  it("accepts file get content of 1048576 bytes", async () => {
    const content = "x".repeat(1_048_576);
    await control({ stdout: JSON.stringify({ ...fileOutput, size: 1_048_576, content }) });
    const result = await runAdapterCommand(
      request(["file", "get", FILE, "--ref", "main"]),
      options,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("counts the content of file get in bytes, not characters", async () => {
    const content = "é".repeat(600_000);
    await control({ stdout: JSON.stringify({ ...fileOutput, size: 1_000, content }) });
    const result = await runAdapterCommand(
      request(["file", "get", FILE, "--ref", "main"]),
      options,
    );
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_output" });
  });

  it.each([
    ["a tag that differs", { tag: "v1.2.1" }],
    ["a name that differs", { name: "other.json" }],
    ["an unknown key", { extra: 1 }],
    ["a size over 5 MB", { size: 5_242_881 }],
    ["content over 5 MB", { content: "x".repeat(5_242_881) }],
  ])("rejects release asset output with %s", async (_name, over) => {
    await control({ stdout: JSON.stringify({ ...assetOutput, ...over }) });
    const result = await runAdapterCommand(
      request(["release", "asset", "v1.2.0", "record-v1.2.0.json"]),
      options,
    );
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_output" });
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["a missing key", { url: undefined }],
    ["a default_branch that is not text", { default_branch: 4 }],
  ])("rejects repo output with %s", async (_name, over) => {
    await control({ stdout: JSON.stringify({ ...repoOutput, ...over }) });
    const result = await runAdapterCommand(request(["repo"]), options);
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_output" });
  });

  it("accepts repo output with an empty default_branch", async () => {
    await control({ stdout: JSON.stringify({ ...repoOutput, default_branch: "" }) });
    const result = await runAdapterCommand(request(["repo"]), options);
    expect(result).toMatchObject({ ok: true });
  });
});
